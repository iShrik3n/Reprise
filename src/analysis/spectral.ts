/**
 * Spectral flatness (Wiener entropy): geometric mean / arithmetic mean of the power
 * spectrum. Near 0 for tonal sounds (energy in a few peaks), higher for noise.
 * For a single periodogram of white noise the expected value is e^(−γ) ≈ 0.56, not 1,
 * because individual bins fluctuate (exponentially distributed power).
 */
export function spectralFlatness(power: Float64Array, kMin: number, kMax: number): number {
  let logSum = 0;
  let sum = 0;
  const eps = 1e-12;
  for (let k = kMin; k <= kMax; k++) {
    logSum += Math.log(power[k] + eps);
    sum += power[k];
  }
  const n = kMax - kMin + 1;
  const arith = sum / n;
  if (arith <= eps) return 1; // silence: no tonal content
  return Math.min(1, Math.exp(logSum / n) / arith);
}

/** Expected flatness of white noise (see above); handy for normalizing to [0, 1]. */
export const WHITE_NOISE_FLATNESS = Math.exp(-0.5772156649);
