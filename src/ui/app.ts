/**
 * App wiring: load (demo or file) → decode on the main thread → analyze + paint in the
 * worker → show. The main thread only decodes audio and blits pixels.
 */
import { ANALYSIS_SAMPLE_RATE, WEIGHT_PRESETS, type WeightPreset } from '../analysis/types';
import { decodeToMono, looksLikeAudio } from '../audio/decode';
import { renderDemo } from '../audio/demo';
import { AbortError, AnalysisClient } from '../worker/client';
import type { RenderPayload } from '../worker/protocol';
import { setupFileInput } from './dropzone';
import { Progress } from './progress';
import { Stage } from './stage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export class App {
  private readonly stage = new Stage($<HTMLCanvasElement>('art'));
  private readonly progress = new Progress($('progress'));
  private readonly client = new AnalysisClient();
  private readonly title = $('title');
  private readonly meta = $('meta');
  private readonly message = $('message');
  private runId = 0;
  private preset: WeightPreset = 'blend';
  private hasResult = false;
  current: RenderPayload | null = null;

  start(): void {
    setupFileInput($<HTMLButtonElement>('open'), $<HTMLInputElement>('file'), (f) => void this.loadFile(f));
    this.setupListenSwitch();
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
    this.stage.setLoading(true);
  }

  private async run(id: number, samples: Float32Array<ArrayBuffer>, sampleRate: number): Promise<void> {
    try {
      const payload = await this.client.analyze(
        samples,
        sampleRate,
        { weights: WEIGHT_PRESETS[this.preset] },
        (stage, f) => id === this.runId && this.progress.show(stage, f),
      );
      if (id === this.runId) this.show(payload);
    } catch (err) {
      if (!(err instanceof AbortError) && id === this.runId) this.fail(err);
    }
  }

  private show(payload: RenderPayload): void {
    this.current = payload;
    this.hasResult = true;
    this.stage.setImage(payload.rgba, payload.size);
    this.stage.setLoading(false);
    this.progress.hide();
    this.meta.textContent = `${formatTime(payload.duration)} · ${payload.size}×${payload.size}`;
    const t = Object.entries(payload.timings).map(([k, v]) => `${k} ${v.toFixed(0)}ms`);
    console.info(`[reprise] ${t.join(', ')}`);
  }

  private setupListenSwitch(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#listen button'));
    const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === this.preset)));
    sync();
    for (const b of buttons) {
      b.addEventListener('click', async () => {
        const preset = b.dataset.preset as WeightPreset;
        if (preset === this.preset) return;
        this.preset = preset;
        sync();
        if (!this.hasResult) return; // the running analysis will be superseded by the next load anyway
        const id = this.runId;
        this.stage.setLoading(true);
        try {
          const payload = await this.client.reweight(WEIGHT_PRESETS[preset], (stage, f) => this.progress.show(stage, f));
          if (id === this.runId && preset === this.preset) this.show(payload);
        } catch (err) {
          if (!(err instanceof AbortError) && id === this.runId) this.fail(err);
        }
      });
    }
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
