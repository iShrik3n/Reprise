import { quantile } from './aggregate';
import type { FeatureMatrix, ProgressFn, SimilarityMatrix } from './types';

/**
 * Cosine self-similarity of L2-normalized rows: S[i][j] = ⟨xᵢ, xⱼ⟩.
 * Only the upper triangle is computed, then mirrored.
 * A silent bin compares as 0 with sound and 1 with other silence, so silences
 * form their own blocks without being confused with music.
 */
export function cosineSelfSimilarity(
  rows: FeatureMatrix,
  silent?: Uint8Array,
  onProgress?: ProgressFn,
): SimilarityMatrix {
  const { data, rows: n, dims } = rows;
  const out = new Float32Array(n * n);
  const reportEvery = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    const oi = i * dims;
    const si = silent ? silent[i] : 0;
    for (let j = i; j < n; j++) {
      let v: number;
      const sj = silent ? silent[j] : 0;
      if (si || sj) {
        v = si && sj ? 1 : 0;
      } else {
        const oj = j * dims;
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += data[oi + d] * data[oj + d];
        v = dot;
      }
      out[i * n + j] = v;
      out[j * n + i] = v;
    }
    if (onProgress && i % reportEvery === 0) onProgress('building matrix', i / n);
  }
  onProgress?.('building matrix', 1);
  return { data: out, size: n };
}

/**
 * Rescale so that the `lowQ` quantile maps to 0 and `highQ` to 1, then apply a gamma.
 * Raw cosine values often sit in a narrow band (e.g. 0.6–1.0 for chroma); stretching that
 * band to the full range is what makes structure visible.
 */
export function contrastStretch(s: SimilarityMatrix, lowQ = 0.05, highQ = 0.99, gamma = 1.6): SimilarityMatrix {
  const lo = quantile(s.data, lowQ);
  const hi = quantile(s.data, highQ);
  const range = hi - lo > 1e-6 ? hi - lo : 1;
  const out = new Float32Array(s.data.length);
  for (let i = 0; i < out.length; i++) {
    let v = (s.data[i] - lo) / range;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    out[i] = Math.pow(v, gamma);
  }
  return { data: out, size: s.size };
}
