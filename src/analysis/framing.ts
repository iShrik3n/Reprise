/**
 * Centered framing: frame t covers samples [t·hop − size/2, t·hop + size/2), zero-padded
 * at the edges. Frame t therefore "happens" at time t·hop / sampleRate, which keeps the
 * mapping between frames and seconds linear and exact.
 */

export function frameCount(signalLength: number, hopSize: number): number {
  return signalLength <= 0 ? 0 : Math.ceil(signalLength / hopSize);
}

/** Copy frame t into `out` (length frameSize), multiplied by `window` when given. */
export function readFrame(
  signal: Float32Array,
  t: number,
  frameSize: number,
  hopSize: number,
  out: Float64Array,
  window?: Float64Array,
): void {
  const start = t * hopSize - (frameSize >> 1);
  const n = signal.length;
  for (let i = 0; i < frameSize; i++) {
    const idx = start + i;
    const v = idx >= 0 && idx < n ? signal[idx] : 0;
    out[i] = window ? v * window[i] : v;
  }
}
