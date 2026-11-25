import type { SimilarityMatrix } from './types';

/**
 * Path enhancement: average S along each diagonal over a window of 2·radius+1 bins.
 *
 * A repeated passage is a *line* parallel to the main diagonal: moment i+k matches moment
 * j+k for many consecutive k. Averaging along that direction keeps such lines at full
 * strength, while isolated coincidental matches (a single similar chord, a drum hit) are
 * diluted. It's the standard trick for making repetition stripes stand out (Müller, FMP §4.2).
 *
 * `mix` blends the smoothed matrix with the original (1 = fully smoothed). A partial mix keeps
 * block structure (sections that sound alike throughout) while still sharpening the stripes.
 *
 * Expects a symmetric matrix (as every self-similarity matrix is): only the upper triangle is
 * read, and the result is mirrored. O(N²) via a running sum along each diagonal; the window
 * shrinks at the matrix edges.
 */
export function enhancePaths(s: SimilarityMatrix, radius: number, mix = 1): SimilarityMatrix {
  const n = s.size;
  const src = s.data;
  if (radius < 1) return { data: src.slice(), size: n };
  const out = new Float32Array(n * n);
  const prefix = new Float64Array(n + 1);
  for (let d = 0; d < n; d++) {
    // Diagonal d: cells (i, i+d) for i = 0 .. n-1-d.
    const len = n - d;
    prefix[0] = 0;
    for (let k = 0; k < len; k++) prefix[k + 1] = prefix[k] + src[k * n + k + d];
    for (let k = 0; k < len; k++) {
      const a = Math.max(0, k - radius);
      const b = Math.min(len - 1, k + radius);
      const idx = k * n + k + d;
      const v = mix * ((prefix[b + 1] - prefix[a]) / (b - a + 1)) + (1 - mix) * src[idx];
      out[idx] = v;
      out[(k + d) * n + k] = v;
    }
  }
  return { data: out, size: n };
}

/** Window radius in bins for a smoothing length of `seconds` (total window ≈ seconds). */
export function enhanceRadius(secondsPerBin: number, seconds = 1): number {
  return Math.max(0, Math.min(64, Math.round(seconds / 2 / secondsPerBin)));
}
