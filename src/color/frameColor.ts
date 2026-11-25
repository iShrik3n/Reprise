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

/** Absolute: hue means the same harmony in every song. Relative: each song is spread over the whole wheel. */
export type ColorMode = 'relative' | 'absolute';

export interface RelativeOptions {
  /** Widest arc of the color wheel the song may use, in turns. A gap is kept so the two harmonic extremes don't meet. */
  maxArc: number;
  /** Most a song's harmonic range may be stretched; stops near-static songs from turning tiny wobbles into a rainbow. */
  maxStretch: number;
}

const DEFAULT_RELATIVE: RelativeOptions = { maxArc: 5 / 6, maxStretch: 4 };

const wrap01 = (h: number) => ((h % 1) + 1) % 1;

/** Fraction of `sorted` strictly below v, scaled to 0..1. */
function rankIn(sorted: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length > 1 ? Math.min(1, lo / (sorted.length - 1)) : 0.5;
}

/**
 * Make the colors relative to the song itself.
 *
 * Most songs stay in one key, whose notes are neighbors on the circle of fifths, so the
 * absolute mapping only reaches about a quarter of the color wheel. Here:
 *
 * Hue. Cut the circle at the widest gap the song never visits, unwrap its hues into a line,
 *   and spread them over up to `maxArc` of the wheel. The spreading is half rank-based
 *   (histogram equalization, so every color gets used) and half linear (so big harmonic jumps
 *   still look bigger than small ones). The mapping is monotonic, so harmonically neighboring
 *   moments keep neighboring colors, and the song's typical harmony stays at the center, so the
 *   key still sets the overall color. Stretching is capped at `maxStretch`.
 * Saturation. A moment is at least as saturated as its tonality rank within the song, so the
 *   song's most tonal passages always get full color while its noisiest stay muted.
 * Lightness is already relative (a loudness percentile).
 *
 * Silent bins are ignored when measuring the song.
 */
export function relativeDescriptors(
  desc: FrameDescriptors,
  silent: Uint8Array,
  opts: RelativeOptions = DEFAULT_RELATIVE,
): FrameDescriptors {
  const n = desc.hue.length;
  const voiced: number[] = [];
  for (let i = 0; i < n; i++) if (!silent[i]) voiced.push(i);
  const m = voiced.length;
  if (m < 8) return desc;

  // Cut the circle at the end of the largest unvisited gap.
  const hs = voiced.map((i) => desc.hue[i]).sort((a, b) => a - b);
  let gap = -1;
  let cut = 0;
  for (let k = 0; k < m; k++) {
    const g = k === m - 1 ? hs[0] + 1 - hs[m - 1] : hs[k + 1] - hs[k];
    if (g > gap) {
      gap = g;
      cut = hs[(k + 1) % m];
    }
  }
  const unwrap = (h: number) => wrap01(h - cut);
  const us = Float64Array.from(voiced, (i) => unwrap(desc.hue[i])).sort();
  const q = (p: number) => us[Math.min(m - 1, Math.max(0, Math.round(p * (m - 1))))];
  const lo = q(0.02);
  const span = Math.max(1e-6, q(0.98) - lo);
  const median = q(0.5);
  const arc = Math.min(opts.maxArc, opts.maxStretch * span);
  const spread = (u: number) => 0.5 * rankIn(us, u) + 0.5 * Math.min(1, Math.max(0, (u - lo) / span));
  const center = spread(median);

  const tonalSorted = Float64Array.from(voiced, (i) => desc.tonal[i]).sort();

  const hue = new Float32Array(n);
  const tonal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hue[i] = wrap01(cut + median + (spread(unwrap(desc.hue[i])) - center) * arc);
    tonal[i] = Math.max(desc.tonal[i], rankIn(tonalSorted, desc.tonal[i]));
  }
  return { hue, tonal, loud: desc.loud };
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
