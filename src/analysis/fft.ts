/**
 * Iterative radix-2 FFT, plus a real-input FFT that packs n real samples into an
 * n/2-point complex FFT (about twice as fast as transforming with zero imaginary parts).
 */

function assertPow2(n: number): void {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two ≥ 2, got ${n}`);
}

/** In-place complex FFT of fixed size n. */
export class ComplexFFT {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    assertPow2(n);
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** Forward transform (e^{-2πikn/N}), in place. */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const a = start + k;
          const b = a + half;
          const wr = cos[tw];
          const wi = sin[tw];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/** FFT of n real samples → n/2+1 complex bins. */
export class RealFFT {
  readonly n: number;
  readonly bins: number;
  private readonly half: ComplexFFT;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(n: number) {
    assertPow2(n);
    if (n < 4) throw new Error('RealFFT size must be ≥ 4');
    this.n = n;
    this.bins = n / 2 + 1;
    const m = n / 2;
    this.half = new ComplexFFT(m);
    this.zr = new Float64Array(m);
    this.zi = new Float64Array(m);
    this.wr = new Float64Array(m + 1);
    this.wi = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.wr[k] = Math.cos((2 * Math.PI * k) / n);
      this.wi[k] = -Math.sin((2 * Math.PI * k) / n);
    }
  }

  /**
   * Transform `input` (length n). Writes n/2+1 bins into outRe/outIm.
   * X[k] = E[k] + W^k O[k], where E/O are the spectra of even/odd samples recovered
   * from Z = FFT(x_even + i·x_odd).
   */
  transform(input: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array): void {
    const m = this.n / 2;
    const { zr, zi, wr, wi } = this;
    for (let k = 0; k < m; k++) {
      zr[k] = input[2 * k];
      zi[k] = input[2 * k + 1];
    }
    this.half.transform(zr, zi);
    for (let k = 0; k <= m; k++) {
      const a = zr[k % m];
      const b = zi[k % m];
      const c = zr[(m - k) % m];
      const d = zi[(m - k) % m];
      const er = (a + c) * 0.5;
      const ei = (b - d) * 0.5;
      const or = (b + d) * 0.5;
      const oi = (c - a) * 0.5;
      outRe[k] = er + wr[k] * or - wi[k] * oi;
      outIm[k] = ei + wr[k] * oi + wi[k] * or;
    }
  }

  /** Power spectrum |X[k]|² for k = 0..n/2. */
  power(input: ArrayLike<number>, out: Float64Array, scratchRe: Float64Array, scratchIm: Float64Array): void {
    this.transform(input, scratchRe, scratchIm);
    for (let k = 0; k < this.bins; k++) out[k] = scratchRe[k] * scratchRe[k] + scratchIm[k] * scratchIm[k];
  }
}

/** Periodic Hann window (the right choice for overlapping STFT frames). */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
