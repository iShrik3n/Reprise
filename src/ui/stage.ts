/**
 * The artwork canvas: keeps an N×N source image and draws it scaled to a centered
 * square that fits the viewport, at device-pixel resolution.
 */
export class Stage {
  private readonly source = document.createElement('canvas');
  private hasImage = false;
  /** Square side in CSS pixels. */
  cssSize = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    window.addEventListener('resize', () => this.layout());
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

  private layout(): void {
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 16;
    const size = Math.max(64, Math.floor(Math.min(window.innerWidth, window.innerHeight) - 2 * gutter));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssSize = size;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.draw();
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
