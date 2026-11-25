/**
 * App wiring: load (demo or file) → decode on the main thread → analyze + paint in the
 * worker → show. The main thread only decodes audio, blits pixels and draws the overlay.
 */
import { ANALYSIS_SAMPLE_RATE, WEIGHT_PRESETS, type WeightPreset } from '../analysis/types';
import { decodeToMono, looksLikeAudio } from '../audio/decode';
import { renderDemo } from '../audio/demo';
import { Player } from '../audio/player';
import { encodeWav } from '../audio/wav';
import type { ColorMode } from '../color/frameColor';
import type { RenderMode } from '../render/painters';
import { AbortError, AnalysisClient } from '../worker/client';
import type { RenderPayload, UpdateRequest } from '../worker/protocol';
import { paletteSwatches, segmented, toggle } from './controls';
import { setupFileInput } from './dropzone';
import { POSTER_SIZE, posterFilename, savePoster } from './export';
import { Overlay } from './overlay';
import { attachPointer } from './pointer';
import { Progress } from './progress';
import { loadSettings, saveSettings, type Settings } from './settings';
import { Stage } from './stage';
import { describePoint, formatTime } from './timeline';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Quick repaints shouldn't flash the progress bar; only show it if work takes longer than this. */
const PROGRESS_DELAY_MS = 160;
/** Gallery mode: controls fade out after this long without input. */
const IDLE_MS = 2500;
const SEEK_STEP_S = 5;

export class App {
  private readonly stage = new Stage($('stage'), $('frame'), $('art'), $('overlay'), $('controls'));
  private readonly overlay = new Overlay(this.stage);
  private readonly progress = new Progress($('progress'));
  private readonly client = new AnalysisClient();
  private readonly player = new Player();
  private readonly title = $('title');
  private readonly meta = $('meta');
  private readonly clock = $('clock');
  private readonly playButton = $<HTMLButtonElement>('play');
  private readonly exportButton = $<HTMLButtonElement>('export');
  private readonly tooltip = $('tooltip');
  private readonly message = $('message');
  private readonly settings: Settings = loadSettings();
  private runId = 0;
  private updateId = 0;
  private analyzed = false;
  private songTitle = '';
  private current: RenderPayload | null = null;
  private rafId = 0;

  start(): void {
    setupFileInput($<HTMLButtonElement>('open'), $<HTMLInputElement>('file'), (f) => void this.loadFile(f));
    this.setupControls();
    this.setupTransport();
    this.setupArtworkPointer();
    this.setupKeyboard();
    this.setupIdle();
    this.stage.onLayout = () => this.overlay.request();
    void this.loadDemo();
  }

  // ── loading ────────────────────────────────────────────────

  async loadDemo(): Promise<void> {
    const id = ++this.runId;
    this.begin('demo · a generated loop');
    this.progress.show('synthesizing');
    await new Promise((r) => setTimeout(r, 0)); // let the label paint before synthesis
    if (id !== this.runId) return;
    const samples = renderDemo(ANALYSIS_SAMPLE_RATE);
    // Encode for playback before the samples are transferred (and detached) to the worker.
    this.player.load(new Blob([encodeWav(samples, ANALYSIS_SAMPLE_RATE)], { type: 'audio/wav' }));
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
    this.player.load(file);
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
    this.songTitle = title;
    this.title.textContent = title;
    this.meta.textContent = '';
    this.analyzed = false;
    this.current = null;
    this.exportButton.disabled = true;
    this.overlay.set({ edges: null, playhead: null, hover: null });
    this.hideTooltip();
    this.stage.setLoading(true);
    this.syncTransport();
  }

  private async run(id: number, samples: Float32Array<ArrayBuffer>, sampleRate: number): Promise<void> {
    const { mode, palette, enhance, preset, color } = this.settings;
    try {
      const payload = await this.client.analyze(
        samples,
        sampleRate,
        { weights: WEIGHT_PRESETS[preset] },
        { mode, palette, enhance, color },
        (stage, f) => id === this.runId && this.progress.show(stage, f),
      );
      if (id !== this.runId) return;
      this.analyzed = true;
      this.exportButton.disabled = false;
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
    this.meta.textContent = `${payload.size}×${payload.size}`;
    this.overlay.set({
      mode: payload.mode,
      edges: payload.binEdges,
      light: payload.mode === 'print' || payload.palette === 'paper',
    });
    this.syncTransport();
    const t = Object.entries(payload.timings).map(([k, v]) => `${k} ${v.toFixed(0)}ms`);
    console.info(`[reprise] ${payload.mode}/${payload.palette}: ${t.join(', ')}`);
  }

  // ── playback ───────────────────────────────────────────────

  private setupTransport(): void {
    this.playButton.addEventListener('click', () => this.player.toggle());
    const audio = this.player.audio;
    for (const ev of ['play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'emptied']) {
      audio.addEventListener(ev, () => this.syncTransport());
    }
    audio.addEventListener('play', () => this.loop());
  }

  /** While playing, move the playhead every frame. */
  private loop(): void {
    cancelAnimationFrame(this.rafId);
    const tick = () => {
      this.syncTransport();
      if (this.player.playing) this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private syncTransport(): void {
    const playing = this.player.playing;
    this.playButton.textContent = playing ? 'pause' : 'play';
    this.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const duration = this.current?.duration ?? this.player.audio.duration;
    const t = this.player.time;
    const text = Number.isFinite(duration) ? `${formatTime(t)} / ${formatTime(duration)}` : formatTime(t);
    if (this.clock.textContent !== text) this.clock.textContent = text;
    // Hide the playhead until something has played, so a fresh image isn't crossed out at 0:00.
    const playhead = this.current && (playing || t > 0) ? t : null;
    if (playhead !== this.overlay.state.playhead) this.overlay.set({ playhead });
  }

  private seek(seconds: number, play: boolean): void {
    if (!this.current) return;
    this.player.seek(Math.max(0, Math.min(this.current.duration, seconds)));
    if (play && !this.player.playing) void this.player.play();
    this.syncTransport();
  }

  // ── pointer: hover tooltip and click-to-seek ───────────────

  private setupArtworkPointer(): void {
    attachPointer(this.stage.overlay, {
      hover: (x, y) => {
        if (!this.current) return;
        const { fx, fy } = this.stage.toFraction(x, y);
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return this.hideTooltip();
        this.overlay.set({ hover: { fx, fy } });
        this.showTooltip(describePoint(this.current.mode, this.current.binEdges, fx, fy).label, x, y);
      },
      leave: () => this.hideTooltip(),
      tap: (x, y) => {
        if (!this.current) return;
        const { fx, fy } = this.stage.toFraction(x, y);
        this.seek(describePoint(this.current.mode, this.current.binEdges, fx, fy).seek, true);
      },
    });
  }

  private showTooltip(text: string, x: number, y: number): void {
    const tip = this.tooltip;
    tip.textContent = text;
    tip.hidden = false;
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = x + pad + w > window.innerWidth - 8 ? x - pad - w : x + pad;
    const top = y + pad + h > window.innerHeight - 8 ? y - pad - h : y + pad;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tip.style.left = '0';
    tip.style.top = '0';
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
    if (this.overlay.state.hover) this.overlay.set({ hover: null });
  }

  // ── controls ───────────────────────────────────────────────

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
    segmented<ColorMode>(
      $('color'),
      [
        { value: 'relative', label: 'relative', title: "Colors spread across this song's own harmonic range" },
        { value: 'absolute', label: 'absolute', title: 'The same harmony gets the same hue in every song' },
      ],
      s.color,
      (color) => void this.change({ color }, { view: { color } }),
    );
    paletteSwatches($('palettes'), s.palette, (palette) => void this.change({ palette }, { view: { palette } }));
    toggle($<HTMLButtonElement>('enhance'), s.enhance, (enhance) => void this.change({ enhance }, { view: { enhance } }));
    this.exportButton.disabled = true;
    this.exportButton.addEventListener('click', () => void this.exportPoster());

    // A mouse click leaves focus on the button, and Space would then press it again instead
    // of toggling playback. Keyboard-initiated clicks (detail 0) keep their focus.
    document.addEventListener('click', (e) => {
      if (e.detail > 0 && e.target instanceof HTMLButtonElement) e.target.blur();
    });
  }

  private async exportPoster(): Promise<void> {
    if (!this.current) return;
    const run = this.runId;
    const button = this.exportButton;
    button.disabled = true;
    button.textContent = 'exporting…';
    try {
      const payload = await this.client.exportImage(POSTER_SIZE, (stage, f) => this.progress.show(`poster · ${stage}`, f));
      if (run !== this.runId) return;
      this.progress.show('poster · encoding png');
      await savePoster(payload, POSTER_SIZE, posterFilename(this.songTitle, payload.mode, payload.palette));
    } catch (err) {
      if (!(err instanceof AbortError) && run === this.runId) this.fail(err);
    } finally {
      this.progress.hide();
      button.textContent = 'export';
      button.disabled = !this.analyzed;
    }
  }

  // ── keyboard & idle ────────────────────────────────────────

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement;
      if (e.code === 'Space' && !onControl) {
        e.preventDefault();
        this.player.toggle();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        this.seek(this.player.time + (e.code === 'ArrowLeft' ? -SEEK_STEP_S : SEEK_STEP_S), false);
      }
    });
  }

  private setupIdle(): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(timer);
      timer = setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, wake, { passive: true });
    wake();
  }

  // ── messages ───────────────────────────────────────────────

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
