/**
 * App wiring for milestone 1: load (demo or file) → analyze on the main thread → paint grayscale.
 * Milestone 2 moves `analyze` into a Web Worker behind the same call shape.
 */
import { analyze } from '../analysis/pipeline';
import { ANALYSIS_SAMPLE_RATE, type AnalysisResult } from '../analysis/types';
import { decodeToMono, looksLikeAudio } from '../audio/decode';
import { renderDemo } from '../audio/demo';
import { paintGrayscale } from '../render/painters';
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

/** Let the browser paint (progress label, dimmed canvas) before blocking work starts. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class App {
  private readonly stage = new Stage($<HTMLCanvasElement>('art'));
  private readonly progress = new Progress($('progress'));
  private readonly title = $('title');
  private readonly meta = $('meta');
  private readonly message = $('message');
  private runId = 0;
  result: AnalysisResult | null = null;

  start(): void {
    setupFileInput($<HTMLButtonElement>('open'), $<HTMLInputElement>('file'), (f) => void this.loadFile(f));
    void this.loadDemo();
  }

  async loadDemo(): Promise<void> {
    const id = ++this.runId;
    this.begin('demo · a generated loop');
    this.progress.show('synthesizing');
    await nextPaint();
    const samples = renderDemo(ANALYSIS_SAMPLE_RATE);
    await this.run(id, samples, ANALYSIS_SAMPLE_RATE);
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
      if (id !== this.runId) return;
      this.fail(err);
    }
  }

  private begin(title: string): void {
    this.showMessage('');
    this.title.textContent = title;
    this.meta.textContent = '';
    this.stage.setLoading(true);
  }

  private async run(id: number, samples: Float32Array, sampleRate: number): Promise<void> {
    this.progress.show('analyzing');
    await nextPaint();
    if (id !== this.runId) return;
    const t0 = performance.now();
    const result = analyze(samples, sampleRate);
    const rgba = paintGrayscale(result.display);
    if (id !== this.runId) return;
    this.result = result;
    this.stage.setImage(rgba, result.size);
    this.stage.setLoading(false);
    this.progress.hide();
    this.meta.textContent = `${formatTime(result.duration)} · ${result.size}×${result.size}`;
    console.info(`analysis: ${(performance.now() - t0).toFixed(0)} ms for ${result.duration.toFixed(1)} s of audio`);
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
