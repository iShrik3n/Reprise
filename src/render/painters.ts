/**
 * Pure pixel painters: matrix + per-bin colors → RGBA buffer of size N×N.
 * Row i is the y axis (top = start of the song), column j is the x axis.
 * No DOM here; the result is handed to ImageData on the main thread.
 */
import type { SimilarityMatrix } from '../analysis/types';
import { encode8, labToLinear, lchToLabInGamut, type Vec3 } from '../color/oklab';
import type { Palette } from '../color/palettes';

export type RenderMode = 'bloom' | 'heatmap' | 'lag' | 'print';
export const RENDER_MODES: RenderMode[] = ['bloom', 'heatmap', 'lag', 'print'];

type Rgba = Uint8ClampedArray<ArrayBuffer>;

/** Classic grayscale: white = similar, black = dissimilar. */
export function paintGrayscale(s: SimilarityMatrix): Rgba {
  const n = s.size;
  const out = new Uint8ClampedArray(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const g = s.data[k] * 255;
    const o = k * 4;
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Shared bloom pixel: start from the palette background and move towards the OKLab
 * midpoint of the two moments' colors by the similarity s, so similar moments glow in their
 * shared color and dissimilar ones sink into the background. Very high similarity also
 * gets a small lightness lift (the "glow").
 */
/**
 * Bloom response curve. The display matrix carries a gamma of 1.6 tuned for the heatmap;
 * for color blending we want mid-similarities to keep some of their color, so we lift it.
 */
const BLOOM_EXPONENT = 0.8;
const BLOOM_LUT = Float32Array.from({ length: 1024 }, (_, k) => Math.pow(k / 1023, BLOOM_EXPONENT));

class BloomBlender {
  private readonly bg: Vec3;
  private readonly tmp: Vec3 = [0, 0, 0];

  constructor(
    private readonly colors: Float32Array,
    private readonly glow: number,
    bg: Vec3,
  ) {
    this.bg = bg;
  }

  write(out: Rgba, o: number, sim: number, i: number, j: number): void {
    const s = BLOOM_LUT[(sim * 1023 + 0.5) | 0];
    const c = this.colors;
    const bg = this.bg;
    const i3 = i * 3;
    const j3 = j * 3;
    const mL = 0.5 * (c[i3] + c[j3]);
    const ma = 0.5 * (c[i3 + 1] + c[j3 + 1]);
    const mb = 0.5 * (c[i3 + 2] + c[j3 + 2]);
    let L = bg[0] + (mL - bg[0]) * s;
    const a = bg[1] + (ma - bg[1]) * s;
    const b = bg[2] + (mb - bg[2]) * s;
    if (this.glow > 0) {
      const s2 = s * s;
      const s4 = s2 * s2;
      L += this.glow * s4 * s4 * (1 - L);
    }
    const lin = labToLinear(L, a, b, this.tmp);
    out[o] = encode8(lin[0]);
    out[o + 1] = encode8(lin[1]);
    out[o + 2] = encode8(lin[2]);
    out[o + 3] = 255;
  }

  writeBackground(out: Rgba, o: number): void {
    const lin = labToLinear(this.bg[0], this.bg[1], this.bg[2], this.tmp);
    out[o] = encode8(lin[0]);
    out[o + 1] = encode8(lin[1]);
    out[o + 2] = encode8(lin[2]);
    out[o + 3] = 255;
  }
}

/** The signature mode: pixel (i, j) blends the colors of moments i and j by their similarity. */
export function paintBloom(display: SimilarityMatrix, colors: Float32Array, palette: Palette): Rgba {
  const n = display.size;
  const out = new Uint8ClampedArray(n * n * 4);
  const blend = new BloomBlender(colors, palette.glow, lchToLabInGamut(palette.background));
  const d = display.data;
  // S and the color midpoint are both symmetric, so paint the upper triangle and mirror it.
  const out32 = new Uint32Array(out.buffer);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const k = i * n + j;
      blend.write(out, k * 4, d[k], i, j);
      out32[j * n + i] = out32[k];
    }
  }
  return out;
}

/**
 * Time × lag: x = time i, y = how far back we look (lag ℓ, 0 at the bottom).
 * Pixel (i, ℓ) shows S(i, i−ℓ), so a passage that repeats L seconds later, which is a diagonal
 * in the square view, becomes a horizontal line at height L. The upper-left triangle
 * (looking back before the song started) stays empty.
 */
export function paintLag(display: SimilarityMatrix, colors: Float32Array, palette: Palette): Rgba {
  const n = display.size;
  const out = new Uint8ClampedArray(n * n * 4);
  const blend = new BloomBlender(colors, palette.glow, lchToLabInGamut(palette.background));
  const d = display.data;
  for (let y = 0; y < n; y++) {
    const lag = n - 1 - y;
    for (let i = 0; i < n; i++) {
      const o = (y * n + i) * 4;
      const j = i - lag;
      if (j < 0) blend.writeBackground(out, o);
      else blend.write(out, o, d[i * n + j], i, j);
    }
  }
  return out;
}

/** 256-entry RGB lookup table interpolated through the palette's ramp in OKLab. */
export function rampLut(stops: Palette['ramp']): Uint8Array {
  const labs = stops.map(lchToLabInGamut);
  const lut = new Uint8Array(256 * 3);
  const tmp: Vec3 = [0, 0, 0];
  for (let k = 0; k < 256; k++) {
    const t = (k / 255) * (labs.length - 1);
    const seg = Math.min(labs.length - 2, Math.floor(t));
    const f = t - seg;
    const [a, b] = [labs[seg], labs[seg + 1]];
    labToLinear(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, tmp);
    lut[k * 3] = encode8(tmp[0]);
    lut[k * 3 + 1] = encode8(tmp[1]);
    lut[k * 3 + 2] = encode8(tmp[2]);
  }
  return lut;
}

/** The classic similarity heatmap, through the palette's perceptual ramp. */
export function paintHeatmap(display: SimilarityMatrix, palette: Palette): Rgba {
  const n = display.size;
  const lut = rampLut(palette.ramp);
  const out = new Uint8ClampedArray(n * n * 4);
  const d = display.data;
  for (let k = 0; k < n * n; k++) {
    const idx = Math.min(255, Math.max(0, (d[k] * 255 + 0.5) | 0)) * 3;
    const o = k * 4;
    out[o] = lut[idx];
    out[o + 1] = lut[idx + 1];
    out[o + 2] = lut[idx + 2];
    out[o + 3] = 255;
  }
  return out;
}

/** Thresholded recurrence plot, printed in ink on paper. */
export function paintPrint(mask: Uint8Array, n: number, palette: Palette): Rgba {
  const toRgb = (lch: Palette['paper']) => {
    const lin = labToLinear(...lchToLabInGamut(lch));
    return lin.map(encode8);
  };
  const paper = toRgb(palette.paper);
  const ink = toRgb(palette.ink);
  const out = new Uint8ClampedArray(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const c = mask[k] ? ink : paper;
    const o = k * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  }
  return out;
}
