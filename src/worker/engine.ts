/**
 * The stateful analysis engine that lives inside the worker. It keeps every pipeline stage
 * cached, so changing similarity weights (and, later, render mode or palette) doesn't
 * re-run the FFT pass. Pure TypeScript with no worker or DOM APIs, so it's tested in Node.
 */
import { binFeatures, buildMatrix } from '../analysis/pipeline';
import { extractFeatures } from '../analysis/features';
import {
  DEFAULT_OPTIONS,
  type AnalysisOptions,
  type BinFeatures,
  type FrameFeatures,
  type ProgressFn,
  type SimilarityMatrix,
  type SimilarityWeights,
} from '../analysis/types';
import { paintGrayscale } from '../render/painters';

export interface RenderPayload {
  size: number;
  duration: number;
  binEdges: Float64Array<ArrayBuffer>;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** Milliseconds per stage, for diagnostics. */
  timings: Record<string, number>;
}

/** Map a stage's own 0..1 progress onto a slice of the overall bar. */
function slice(onProgress: ProgressFn | undefined, from: number, to: number): ProgressFn | undefined {
  return onProgress && ((stage, f) => onProgress(stage, from + (to - from) * f));
}

export class AnalysisEngine {
  private frames: FrameFeatures | null = null;
  private bins: BinFeatures | null = null;
  private display: SimilarityMatrix | null = null;
  private options: AnalysisOptions = DEFAULT_OPTIONS;

  analyze(
    samples: Float32Array,
    sampleRate: number,
    options: Partial<AnalysisOptions> = {},
    onProgress?: ProgressFn,
  ): RenderPayload {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const timings: Record<string, number> = {};
    let t = performance.now();
    this.frames = extractFeatures(samples, sampleRate, this.options, slice(onProgress, 0, 0.8));
    timings.features = performance.now() - t;
    t = performance.now();
    this.bins = binFeatures(this.frames, this.options.maxBins);
    timings.binning = performance.now() - t;
    return this.rebuild(this.options.weights, timings, slice(onProgress, 0.8, 1));
  }

  setWeights(weights: SimilarityWeights, onProgress?: ProgressFn): RenderPayload {
    if (!this.bins) throw new Error('Nothing analyzed yet');
    this.options = { ...this.options, weights };
    return this.rebuild(weights, {}, onProgress);
  }

  private rebuild(weights: SimilarityWeights, timings: Record<string, number>, onProgress?: ProgressFn): RenderPayload {
    const bins = this.bins!;
    let t = performance.now();
    this.display = buildMatrix(bins, weights, slice(onProgress, 0, 0.9)).display;
    timings.matrix = performance.now() - t;
    t = performance.now();
    onProgress?.('painting', 0.95);
    const rgba = paintGrayscale(this.display);
    timings.paint = performance.now() - t;
    onProgress?.('painting', 1);
    return {
      size: bins.size,
      duration: bins.duration,
      binEdges: Float64Array.from(bins.binEdges),
      rgba,
      timings,
    };
  }
}
