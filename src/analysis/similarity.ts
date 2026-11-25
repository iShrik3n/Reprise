import { quantile } from './aggregate';
import type { FeatureMatrix, ProgressFn, SimilarityMatrix, SimilarityWeights } from './types';

/**
 * Concatenate L2-normalized feature blocks, scaling block k by √(wₖ / Σw). The dot product
 * of two stacked rows is then Σ wₖ·cosₖ / Σw, a weighted average of per-feature cosine
 * similarities, computed in a single pass.
 */
export function stackBlocks(blocks: Array<{ m: FeatureMatrix; weight: number }>): FeatureMatrix {
  const active = blocks.filter((b) => b.weight > 0);
  if (active.length === 0) throw new Error('At least one feature block needs a positive weight');
  const rows = active[0].m.rows;
  const total = active.reduce((s, b) => s + b.weight, 0);
  const dims = active.reduce((s, b) => s + b.m.dims, 0);
  const data = new Float32Array(rows * dims);
  let col = 0;
  for (const { m, weight } of active) {
    if (m.rows !== rows) throw new Error('Feature blocks must have the same number of rows');
    const scale = Math.sqrt(weight / total);
    for (let r = 0; r < rows; r++) {
      for (let d = 0; d < m.dims; d++) data[r * dims + col + d] = m.data[r * m.dims + d] * scale;
    }
    col += m.dims;
  }
  return { data, rows, dims };
}

export interface SelfSimilarityOptions {
  /** Silent bins compare as 0 with sound and 1 with other silence. */
  silent?: Uint8Array;
  /** Loudness per bin (dB). When given with energyWeight λ > 0: S = (1−λ)·dot + λ·exp(−|ΔdB|/σ). */
  energyDb?: Float32Array;
  energyWeight?: number;
  energySigmaDb?: number;
  onProgress?: ProgressFn;
}

/**
 * S[i][j] = ⟨xᵢ, xⱼ⟩ for rows that are (stacked) unit vectors, optionally blended with a
 * loudness kernel. RMS is a single number per bin, so its "cosine" would always be 1;
 * comparing loudness through a distance kernel is the meaningful equivalent.
 * Only the upper triangle is computed, then mirrored.
 */
export function selfSimilarity(rows: FeatureMatrix, opts: SelfSimilarityOptions = {}): SimilarityMatrix {
  const { data, rows: n, dims } = rows;
  const { silent, energyDb, onProgress } = opts;
  const lambda = energyDb ? (opts.energyWeight ?? 0) : 0;
  const invSigma = 1 / (opts.energySigmaDb ?? 6);
  const out = new Float32Array(n * n);
  const reportEvery = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    const oi = i * dims;
    const si = silent ? silent[i] : 0;
    for (let j = i; j < n; j++) {
      const sj = silent ? silent[j] : 0;
      let v: number;
      if (si || sj) {
        v = si && sj ? 1 : 0;
      } else {
        const oj = j * dims;
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += data[oi + d] * data[oj + d];
        v = dot;
        if (lambda > 0) v = (1 - lambda) * dot + lambda * Math.exp(-Math.abs(energyDb![i] - energyDb![j]) * invSigma);
      }
      out[i * n + j] = v;
      out[j * n + i] = v;
    }
    if (onProgress && i % reportEvery === 0) onProgress('building matrix', (i * (2 * n - i)) / (n * n));
  }
  onProgress?.('building matrix', 1);
  return { data: out, size: n };
}

/** Weighted chroma/MFCC/energy similarity from bin features. */
export function weightedSimilarity(
  chroma: FeatureMatrix,
  mfcc: FeatureMatrix,
  weights: SimilarityWeights,
  extra: Omit<SelfSimilarityOptions, 'energyWeight'> = {},
): SimilarityMatrix {
  const stacked = stackBlocks([
    { m: chroma, weight: weights.chroma },
    { m: mfcc, weight: weights.mfcc },
  ]);
  return selfSimilarity(stacked, { ...extra, energyWeight: weights.energy });
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
