/**
 * The artwork: an N×N source image drawn scaled into a centered square, plus a transparent
 * overlay canvas of the same size for the playhead and hover guides. The square is sized to
 * the space left above the control strip, so the two never overlap.
 */
export class Stage {
  private readonly source = document.createElement('canvas');
  private hasImage = false;
  /** Square side in CSS pixels. */
  cssSize = 0;
  dpr = 1;
  onLayout: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly frame: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    readonly overlay: HTMLCanvasElement,
    private readonly controls: HTMLElement,
  ) {
    window.addEventListener('resize', () => this.layout());
    new ResizeObserver(() => this.layout()).observe(controls);
    this.layout();
  }

  setImage(rgba: Uint8ClampedArray<ArrayBuffer>, n: number): void {
    this.source.width = n;
    this.source.height = n;
    this.source.getContext('2d')!.putImageData(new ImageData(rgba, n, n), 0, 0);
    this.hasImage = true;
    this.draw();
  }

  setLoading(on: boolean): void {
    this.canvas.classList.toggle('loading', on);
  }

  /** Pointer position → fractions of the square (may fall outside 0..1). */
  toFraction(clientX: number, clientY: number): { fx: number; fy: number } {
    const r = this.canvas.getBoundingClientRect();
    return { fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height };
  }

  layout(): void {
    const css = getComputedStyle(document.documentElement);
    const gutter = parseFloat(css.getPropertyValue('--gutter')) || 16;
    const reserve = Math.ceil(this.controls.getBoundingClientRect().height) + 28;
    this.root.style.bottom = `${reserve}px`;
    const availW = window.innerWidth - 2 * gutter;
    const availH = window.innerHeight - reserve - gutter;
    const size = Math.max(64, Math.floor(Math.min(availW, availH)));
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssSize = size;
    this.frame.style.width = `${size}px`;
    this.frame.style.height = `${size}px`;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(size * this.dpr);
      c.height = Math.round(size * this.dpr);
    }
    this.draw();
    this.onLayout?.();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.hasImage) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
  }
}
