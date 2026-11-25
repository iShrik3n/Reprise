import type { SimilarityMatrix } from './types';

/**
 * Lag profile: P[ℓ] = mean over i of S[i][i+ℓ], the average brightness of the ℓ-th
 * diagonal. If the music repeats every L bins, the diagonal at ℓ = L is bright along
 * its length, so P has a peak there.
 */
export function lagProfile(s: SimilarityMatrix): Float32Array {
  const n = s.size;
  const out = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += s.data[i * n + i + lag];
    out[lag] = acc / (n - lag);
  }
  return out;
}

/** Index and height of the highest lag peak in [minLag, maxLag], and its height above the median of that range. */
export function strongestLag(profile: Float32Array, minLag: number, maxLag = profile.length - 1) {
  const range = Array.from(profile.subarray(minLag, maxLag + 1));
  let best = 0;
  for (let i = 1; i < range.length; i++) if (range[i] > range[best]) best = i;
  const sorted = [...range].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { lag: minLag + best, value: range[best], prominence: range[best] - median };
}
