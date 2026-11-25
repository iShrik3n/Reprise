/**
 * One color per time bin, derived from the sound itself:
 *   hue        where the harmony sits on the circle of fifths (related keys → neighboring hues)
 *   lightness  how loud the moment is, relative to the rest of the song
 *   chroma     how tonal (vs noisy) it is: low spectral flatness and a focused pitch-class profile
 */
import { WHITE_NOISE_FLATNESS } from '../analysis/spectral';
import type { BinFeatures } from '../analysis/types';
import { lchToLabInGamut } from './oklab';
import type { Palette } from './palettes';

/** Position of pitch class p on the circle of fifths, as a fraction of a turn (C=0, G=1/12, D=2/12, …). */
export const fifthsPosition = (pc: number): number => ((pc * 7) % 12) / 12;

/**
 * Chroma-weighted circular mean on the circle of fifths. Squaring the weights favors the
 * dominant pitch classes. Returns the hue (0..1 of a turn) and the clarity (resultant length 0..1:
 * 1 for a single note, ≈0 for an even spread such as noise).
 */
export function fifthsHue(chroma: ArrayLike<number>, offset = 0): { hue: number; clarity: number; x: number; y: number } {
  let x = 0;
  let y = 0;
  let w = 0;
  for (let p = 0; p < 12; p++) {
    const c = chroma[offset + p];
    const wt = c * c;
    const a = 2 * Math.PI * fifthsPosition(p);
    x += wt * Math.cos(a);
    y += wt * Math.sin(a);
    w += wt;
  }
  if (w <= 0) return { hue: 0, clarity: 0, x: 0, y: 0 };
  x /= w;
  y /= w;
  const hue = ((Math.atan2(y, x) / (2 * Math.PI)) % 1 + 1) % 1;
  return { hue, clarity: Math.hypot(x, y), x, y };
}

export interface FrameDescriptors {
  hue: Float32Array;
  tonal: Float32Array;
  loud: Float32Array;
}

/** Per-bin hue/tonal/loud descriptors, independent of the palette (so palette changes are cheap). */
export function frameDescriptors(bins: BinFeatures): FrameDescriptors {
  const n = bins.size;
  const secondsPerBin = bins.duration / n;
  // Smooth the harmony vector over ~0.4 s so hues don't flicker from bin to bin.
  const radius = Math.max(0, Math.min(8, Math.round(0.2 / secondsPerBin)));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const clar = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = fifthsHue(bins.chroma.data, i * 12);
    xs[i] = r.x;
    ys[i] = r.y;
    clar[i] = r.clarity;
  }

  // Loudness percentile among non-silent bins.
  const voiced = Array.from(bins.rmsDb).filter((_, i) => !bins.silent[i]).sort((a, b) => a - b);
  const percentile = (v: number) => {
    if (voiced.length < 2) return 0.5;
    let lo = 0;
    let hi = voiced.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (voiced[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (voiced.length - 1);
  };

  const hue = new Float32Array(n);
  const tonal = new Float32Array(n);
  const loud = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) {
      sx += xs[k];
      sy += ys[k];
    }
    hue[i] = ((Math.atan2(sy, sx) / (2 * Math.PI)) % 1 + 1) % 1;
    const tonalness = Math.max(0, 1 - bins.flatness[i] / (0.8 * WHITE_NOISE_FLATNESS));
    const focus = Math.min(1, clar[i] * 1.6);
    tonal[i] = Math.pow(tonalness, 0.7) * Math.pow(focus, 0.7);
    loud[i] = Math.min(1, Math.max(0, percentile(bins.rmsDb[i])));
  }
  return { hue, tonal, loud };
}

/** OKLab color per bin (n×3), with silent bins set to the background. */
export function frameColors(desc: FrameDescriptors, silent: Uint8Array, palette: Palette): Float32Array {
  const n = desc.hue.length;
  const out = new Float32Array(n * 3);
  const bg = lchToLabInGamut(palette.background);
  for (let i = 0; i < n; i++) {
    const lab = silent[i] ? bg : lchToLabInGamut(palette.color(desc.hue[i], desc.tonal[i], desc.loud[i]));
    out[i * 3] = lab[0];
    out[i * 3 + 1] = lab[1];
    out[i * 3 + 2] = lab[2];
  }
  return out;
}
