/**
 * App wiring: load (demo or file) → decode on the main thread → analyze + paint in the
 * worker → show. The main thread only decodes audio and blits pixels.
 */
import { ANALYSIS_SAMPLE_RATE, WEIGHT_PRESETS, type WeightPreset } from '../analysis/types';
import { decodeToMono, looksLikeAudio } from '../audio/decode';
import { renderDemo } from '../audio/demo';
import type { RenderMode } from '../render/painters';
import { AbortError, AnalysisClient } from '../worker/client';
import type { RenderPayload, UpdateRequest } from '../worker/protocol';
import { paletteSwatches, segmented, toggle } from './controls';
import { setupFileInput } from './dropzone';
import { Progress } from './progress';
import { loadSettings, saveSettings, type Settings } from './settings';
import { Stage } from './stage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Quick repaints shouldn't flash the progress bar; only show it if work takes longer than this. */
const PROGRESS_DELAY_MS = 160;

export class App {
  private readonly stage = new Stage($<HTMLCanvasElement>('art'));
  private readonly progress = new Progress($('progress'));
  private readonly client = new AnalysisClient();
  private readonly title = $('title');
  private readonly meta = $('meta');
  private readonly message = $('message');
  private readonly settings: Settings = loadSettings();
  private runId = 0;
  private updateId = 0;
  private analyzed = false;
  current: RenderPayload | null = null;

  start(): void {
    setupFileInput($<HTMLButtonElement>('open'), $<HTMLInputElement>('file'), (f) => void this.loadFile(f));
    this.setupControls();
    void this.loadDemo();
  }

  async loadDemo(): Promise<void> {
    const id = ++this.runId;
    this.begin('demo · a generated loop');
    this.progress.show('synthesizing');
    await new Promise((r) => setTimeout(r, 0)); // let the label paint before synthesis
    if (id !== this.runId) return;
    await this.run(id, renderDemo(ANALYSIS_SAMPLE_RATE), ANALYSIS_SAMPLE_RATE);
  }

  async loadFile(file: File): Promise<void> {
    if (!looksLikeAudio(file)) {
      this.showMessage(`“${file.name}” doesn't look like an audio file.`);
      return;
    }
    const id = ++this.runId;
    this.begin(file.name.replace(/\.[^.]+$/, ''));
    this.progress.show('decoding');
    try {
      const decoded = await decodeToMono(await file.arrayBuffer(), ANALYSIS_SAMPLE_RATE);
      if (id !== this.runId) return;
      await this.run(id, decoded.samples, decoded.sampleRate);
    } catch (err) {
      if (id === this.runId) this.fail(err);
    }
  }

  private begin(title: string): void {
    this.showMessage('');
    this.title.textContent = title;
    this.meta.textContent = '';
    this.analyzed = false;
    this.stage.setLoading(true);
  }

  private async run(id: number, samples: Float32Array<ArrayBuffer>, sampleRate: number): Promise<void> {
    const { mode, palette, enhance, preset } = this.settings;
    try {
      const payload = await this.client.analyze(
        samples,
        sampleRate,
        { weights: WEIGHT_PRESETS[preset] },
        { mode, palette, enhance },
        (stage, f) => id === this.runId && this.progress.show(stage, f),
      );
      if (id !== this.runId) return;
      this.analyzed = true;
      this.show(payload);
    } catch (err) {
      if (!(err instanceof AbortError) && id === this.runId) this.fail(err);
    }
  }

  /** Apply a settings change: persist it, and if a song is loaded ask the worker to re-render. */
  private async change(patch: Partial<Settings>, req: UpdateRequest): Promise<void> {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    if (!this.analyzed) return; // the next analysis picks the settings up
    const run = this.runId;
    const id = ++this.updateId;
    const slow = setTimeout(() => {
      this.stage.setLoading(true);
      this.progress.show('rendering');
    }, PROGRESS_DELAY_MS);
    try {
      const payload = await this.client.update(req, (stage, f) => id === this.updateId && this.progress.show(stage, f));
      // Requests are handled in order, so only the newest one needs to be shown.
      if (run === this.runId && id === this.updateId) this.show(payload);
    } catch (err) {
      if (!(err instanceof AbortError) && run === this.runId) this.fail(err);
    } finally {
      clearTimeout(slow);
    }
  }

  private show(payload: RenderPayload): void {
    this.current = payload;
    this.stage.setImage(payload.rgba, payload.size);
    this.stage.setLoading(false);
    this.progress.hide();
    this.meta.textContent = `${formatTime(payload.duration)} · ${payload.size}×${payload.size}`;
    const t = Object.entries(payload.timings).map(([k, v]) => `${k} ${v.toFixed(0)}ms`);
    console.info(`[reprise] ${payload.mode}: ${t.join(', ')}`);
  }

  private setupControls(): void {
    const s = this.settings;
    segmented<RenderMode>(
      $('mode'),
      [
        { value: 'bloom', label: 'bloom', title: 'Each pixel blends the colors of the two moments it compares' },
        { value: 'heatmap', label: 'heatmap', title: 'The classic similarity heatmap' },
        { value: 'lag', label: 'lag', title: 'Time × repetition interval: repeats become horizontal lines' },
        { value: 'print', label: 'print', title: 'Thresholded recurrence plot, ink on paper' },
      ],
      s.mode,
      (mode) => void this.change({ mode }, { view: { mode } }),
    );
    segmented<WeightPreset>(
      $('listen'),
      [
        { value: 'harmony', label: 'harmony', title: 'Compare notes and chords (chroma)' },
        { value: 'timbre', label: 'timbre', title: 'Compare tone color (MFCC)' },
        { value: 'blend', label: 'both', title: 'Harmony and timbre together' },
      ],
      s.preset,
      (preset) => void this.change({ preset }, { weights: WEIGHT_PRESETS[preset] }),
    );
    paletteSwatches($('palettes'), s.palette, (palette) => void this.change({ palette }, { view: { palette } }));
    toggle($<HTMLButtonElement>('enhance'), s.enhance, (enhance) => void this.change({ enhance }, { view: { enhance } }));
  }

  private fail(err: unknown): void {
    this.progress.hide();
    this.stage.setLoading(false);
    this.showMessage(err instanceof Error ? err.message : String(err));
    console.error(err);
  }

  private showMessage(text: string): void {
    this.message.textContent = text;
  }
}
