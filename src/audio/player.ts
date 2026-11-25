/**
 * Playback through a single <audio> element. Files play from an object URL of the original
 * file (full quality, and the browser handles seeking); the demo plays from a WAV blob.
 */
export class Player {
  readonly audio = new Audio();
  private url: string | null = null;

  constructor() {
    this.audio.preload = 'auto';
  }

  load(source: Blob): void {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(source);
    this.audio.src = this.url;
    this.audio.load();
  }

  get time(): number {
    return this.audio.currentTime || 0;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  async play(): Promise<void> {
    try {
      await this.audio.play();
    } catch (err) {
      // Aborted by a new load(), or blocked by autoplay policy: nothing to do.
      if ((err as Error).name !== 'AbortError') console.warn('[reprise] playback failed', err);
    }
  }

  pause(): void {
    this.audio.pause();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(seconds: number): void {
    const d = this.audio.duration;
    this.audio.currentTime = Math.max(0, Number.isFinite(d) ? Math.min(seconds, d - 0.01) : seconds);
  }
}
