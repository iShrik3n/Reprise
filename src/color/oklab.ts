/**
 * OKLab / OKLCH (Björn Ottosson, 2020): a perceptual color space where equal steps look
 * equally different. Lightness, chroma and hue can be set independently, and mixing two
 * colors in OKLab gives a natural-looking midpoint.
 *
 * Pure math, no DOM.
 */

export type Vec3 = [number, number, number];
/** [L 0..1, C ≈0..0.37, h degrees] */
export type Lch = Vec3;
/** [L, a, b] */
export type Lab = Vec3;

export function lchToLab([l, c, h]: Lch): Lab {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

/** OKLab → linear sRGB (may fall outside [0, 1] when out of gamut). */
export function labToLinear(L: number, a: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return out;
}

export function linearToLab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const srgbEncode = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const inGamut = (v: Vec3, eps = 1e-4) => v.every((x) => x >= -eps && x <= 1 + eps);

/** OKLCH → OKLab, reducing chroma (keeping L and h) until the color fits inside sRGB. */
export function lchToLabInGamut(lch: Lch): Lab {
  const [l, c, h] = lch;
  const L = Math.min(1, Math.max(0, l));
  if (inGamut(labToLinear(...lchToLab([L, c, h])))) return lchToLab([L, c, h]);
  let lo = 0;
  let hi = c;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(labToLinear(...lchToLab([L, mid, h])))) lo = mid;
    else hi = mid;
  }
  return lchToLab([L, lo, h]);
}

/**
 * Fast linear → 8-bit sRGB. The table is indexed by √c, which spends its resolution on
 * dark values, where banding against a black background would otherwise show.
 */
const LUT_SIZE = 4096;
const ENCODE_LUT = (() => {
  const t = new Uint8ClampedArray(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = (i / (LUT_SIZE - 1)) ** 2;
    t[i] = Math.round(srgbEncode(c) * 255);
  }
  return t;
})();

export function encode8(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  return ENCODE_LUT[(Math.sqrt(c) * (LUT_SIZE - 1) + 0.5) | 0];
}

/** OKLab → 8-bit sRGB triple (clamped). */
export function labToRgb8(L: number, a: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  labToLinear(L, a, b, out);
  out[0] = encode8(out[0]);
  out[1] = encode8(out[1]);
  out[2] = encode8(out[2]);
  return out;
}

export function lchToCss(lch: Lch): string {
  const [r, g, b] = labToRgb8(...lchToLabInGamut(lch));
  return `rgb(${r} ${g} ${b})`;
}
