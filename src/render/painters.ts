/**
 * Pure pixel painters: matrix (+ per-frame data) → RGBA buffer of size N×N.
 * No DOM here; the result is handed to ImageData on the main thread.
 */
import type { SimilarityMatrix } from '../analysis/types';

/** Classic grayscale: white = similar, black = dissimilar. Row i is the y axis (top = start). */
export function paintGrayscale(s: SimilarityMatrix): Uint8ClampedArray<ArrayBuffer> {
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
