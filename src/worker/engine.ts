/**
 * The stateful analysis engine that lives inside the worker. Every pipeline stage is
 * cached and invalidated only by what it depends on:
 *
 *   samples ─▶ frames ─▶ bins ─┬▶ raw S (weights) ─▶ display (enhance) ─┬▶ pixels (mode)
 *                              │                                      └▶ print mask
 *                              └▶ descriptors ─▶ colors (palette) ──────▶ pixels
 *
 * So switching palette or render mode is a repaint only (tens of ms), and nothing short of
 * a new file re-runs the FFT pass. Pure TypeScript with no worker/DOM APIs, so it's tested in Node.
 */
import { enhancePaths, enhanceRadius } from '../analysis/enhance';
import { extractFeatures } from '../analysis/features';
import { binFeatures } from '../analysis/pipeline';
import { recurrencePlot } from '../analysis/recurrence';
import { contrastStretch, weightedSimilarity } from '../analysis/similarity';
import {
  DEFAULT_OPTIONS,
  type AnalysisOptions,
  type BinFeatures,
  type ProgressFn,
  type SimilarityMatrix,
  type SimilarityWeights,
} from '../analysis/types';
import { frameColors, frameDescriptors, type FrameDescriptors } from '../color/frameColor';
import { PALETTES, type PaletteId } from '../color/palettes';
import { paintBloom, paintHeatmap, paintLag, paintPrint, type RenderMode } from '../render/painters';

export interface ViewSettings {
  mode: RenderMode;
  palette: PaletteId;
  /** Diagonal path enhancement on/off. */
  enhance: boolean;
}

export const DEFAULT_VIEW: ViewSettings = { mode: 'bloom', palette: 'spectrum', enhance: true };

export interface RenderPayload {
  size: number;
  duration: number;
  mode: RenderMode;
  binEdges: Float64Array<ArrayBuffer>;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** Milliseconds per stage that actually ran, for diagnostics. */
  timings: Record<string, number>;
}

export interface UpdateRequest {
  weights?: SimilarityWeights;
  view?: Partial<ViewSettings>;
}

/** Map a stage's own 0..1 progress onto a slice of the overall bar. */
function slice(onProgress: ProgressFn | undefined, from: number, to: number): ProgressFn | undefined {
  return onProgress && ((stage, f) => onProgress(stage, from + (to - from) * f));
}

export class AnalysisEngine {
  private options: AnalysisOptions = DEFAULT_OPTIONS;
  private view: ViewSettings = DEFAULT_VIEW;
  private bins: BinFeatures | null = null;
  private descriptors: FrameDescriptors | null = null;
  private raw: SimilarityMatrix | null = null;
  private display: SimilarityMatrix | null = null;
  private mask: Uint8Array | null = null;
  private colors: Float32Array | null = null;
  private timings: Record<string, number> = {};

  analyze(
    samples: Float32Array,
    sampleRate: number,
    options: Partial<AnalysisOptions> = {},
    view: Partial<ViewSettings> = {},
    onProgress?: ProgressFn,
  ): RenderPayload {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.view = { ...DEFAULT_VIEW, ...view };
    this.timings = {};
    const frames = this.time('features', () =>
      extractFeatures(samples, sampleRate, this.options, slice(onProgress, 0, 0.75)),
    );
    this.bins = this.time('binning', () => binFeatures(frames, this.options.maxBins));
    this.descriptors = this.time('descriptors', () => frameDescriptors(this.bins!));
    this.raw = this.display = this.mask = this.colors = null;
    return this.render(slice(onProgress, 0.75, 1));
  }

  update(req: UpdateRequest, onProgress?: ProgressFn): RenderPayload {
    if (!this.bins) throw new Error('Nothing analyzed yet');
    this.timings = {};
    if (req.weights) {
      this.options = { ...this.options, weights: req.weights };
      this.raw = this.display = this.mask = null;
    }
    if (req.view) {
      const next = { ...this.view, ...req.view };
      if (next.enhance !== this.view.enhance) this.display = this.mask = null;
      if (next.palette !== this.view.palette) this.colors = null;
      this.view = next;
    }
    return this.render(onProgress);
  }

  getView(): ViewSettings {
    return { ...this.view };
  }

  /** Recompute whatever was invalidated, then paint the current mode. */
  private render(onProgress?: ProgressFn): RenderPayload {
    const bins = this.bins!;
    if (!this.raw) {
      const p = slice(onProgress, 0, 0.7);
      this.raw = this.time('matrix', () =>
        weightedSimilarity(bins.chroma, bins.mfcc, this.options.weights, {
          silent: bins.silent,
          energyDb: bins.rmsDb,
          onProgress: p,
        }),
      );
    }
    if (!this.display) {
      onProgress?.('enhancing', 0.75);
      this.display = this.time('enhance', () => {
        const radius = this.view.enhance ? enhanceRadius(bins.duration / bins.size) : 0;
        return contrastStretch(radius > 0 ? enhancePaths(this.raw!, radius, 0.5) : this.raw!);
      });
    }
    const palette = PALETTES[this.view.palette];
    if (!this.colors) this.colors = frameColors(this.descriptors!, bins.silent, palette);

    onProgress?.('painting', 0.85);
    const rgba = this.time('paint', () => {
      switch (this.view.mode) {
        case 'bloom':
          return paintBloom(this.display!, this.colors!, palette);
        case 'lag':
          return paintLag(this.display!, this.colors!, palette);
        case 'heatmap':
          return paintHeatmap(this.display!, palette);
        case 'print':
          this.mask ??= recurrencePlot(this.display!);
          return paintPrint(this.mask, bins.size, palette);
      }
    });
    onProgress?.('painting', 1);
    return {
      size: bins.size,
      duration: bins.duration,
      mode: this.view.mode,
      binEdges: Float64Array.from(bins.binEdges),
      rgba,
      timings: this.timings,
    };
  }

  private time<T>(label: string, fn: () => T): T {
    const t = performance.now();
    const r = fn();
    this.timings[label] = (this.timings[label] ?? 0) + performance.now() - t;
    return r;
  }
}
