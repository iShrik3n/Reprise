/**
 * Mel filterbank: triangular filters spaced evenly on the mel scale
 * (HTK formula: mel = 2595·log10(1 + f/700)), which roughly follows how the ear
 * resolves pitch: fine at low frequencies, coarse at high ones.
 */

export const hzToMel = (f: number): number => 2595 * Math.log10(1 + f / 700);
export const melToHz = (m: number): number => 700 * (Math.pow(10, m / 2595) - 1);

export interface MelFilterbank {
  bands: number;
  /** First FFT bin of each band. */
  start: Int32Array;
  /** Triangle weights for consecutive bins starting at `start[b]`. */
  weights: Float32Array[];
  /** Center frequency of each band (Hz). */
  centers: Float64Array;
}

export function melFilterbank(
  frameSize: number,
  sampleRate: number,
  bands = 40,
  fMin = 30,
  fMax = sampleRate / 2,
): MelFilterbank {
  const binHz = sampleRate / frameSize;
  const maxBin = frameSize / 2;
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(fMax);
  const hz = new Float64Array(bands + 2);
  for (let i = 0; i < bands + 2; i++) hz[i] = melToHz(mMin + ((mMax - mMin) * i) / (bands + 1));

  const start = new Int32Array(bands);
  const weights: Float32Array[] = [];
  const centers = new Float64Array(bands);
  for (let b = 0; b < bands; b++) {
    const [lo, mid, hi] = [hz[b], hz[b + 1], hz[b + 2]];
    centers[b] = mid;
    const k0 = Math.max(0, Math.ceil(lo / binHz));
    const k1 = Math.min(maxBin, Math.floor(hi / binHz));
    const w: number[] = [];
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      w.push(Math.max(0, f <= mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid)));
    }
    // A band narrower than one FFT bin still gets its nearest bin, so it never goes empty.
    if (w.every((x) => x === 0)) {
      start[b] = Math.min(maxBin, Math.round(mid / binHz));
      weights.push(Float32Array.of(1));
    } else {
      start[b] = k0;
      weights.push(Float32Array.from(w));
    }
  }
  return { bands, start, weights, centers };
}

export function applyFilterbank(power: Float64Array, fb: MelFilterbank, out: Float64Array): void {
  for (let b = 0; b < fb.bands; b++) {
    const w = fb.weights[b];
    const s = fb.start[b];
    let acc = 0;
    for (let i = 0; i < w.length; i++) acc += w[i] * power[s + i];
    out[b] = acc;
  }
}
