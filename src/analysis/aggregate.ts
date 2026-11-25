import type { FeatureMatrix } from './types';

/**
 * Split `frameCount` frames into N = min(frameCount, maxBins) contiguous, near-equal bins.
 * Returns N+1 frame indices; bin b covers frames [edges[b], edges[b+1]).
 */
export function binEdges(frameCount: number, maxBins: number): Int32Array {
  const n = Math.max(1, Math.min(frameCount, maxBins));
  const edges = new Int32Array(n + 1);
  for (let b = 0; b <= n; b++) edges[b] = Math.round((b * frameCount) / n);
  return edges;
}

/** Mean of each bin's rows. */
export function aggregateRows(m: FeatureMatrix, edges: Int32Array): FeatureMatrix {
  const n = edges.length - 1;
  const { dims } = m;
  const out = new Float32Array(n * dims);
  for (let b = 0; b < n; b++) {
    const s = edges[b];
    const e = Math.max(edges[b + 1], s + 1);
    for (let r = s; r < e; r++) {
      const off = r * dims;
      for (let d = 0; d < dims; d++) out[b * dims + d] += m.data[off + d];
    }
    const inv = 1 / (e - s);
    for (let d = 0; d < dims; d++) out[b * dims + d] *= inv;
  }
  return { data: out, rows: n, dims };
}

/** Root-mean of squares per bin (the right way to pool RMS values). */
export function aggregateRms(rms: Float32Array, edges: Int32Array): Float32Array {
  const n = edges.length - 1;
  const out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const s = edges[b];
    const e = Math.max(edges[b + 1], s + 1);
    let acc = 0;
    for (let r = s; r < e; r++) acc += rms[r] * rms[r];
    out[b] = Math.sqrt(acc / (e - s));
  }
  return out;
}

/** L2-normalize each row in place. Rows with norm below `eps` become all-zero. */
export function l2NormalizeRows(m: FeatureMatrix, eps = 1e-9): void {
  const { data, rows, dims } = m;
  for (let r = 0; r < rows; r++) {
    const off = r * dims;
    let ss = 0;
    for (let d = 0; d < dims; d++) ss += data[off + d] * data[off + d];
    const norm = Math.sqrt(ss);
    const inv = norm > eps ? 1 / norm : 0;
    for (let d = 0; d < dims; d++) data[off + d] *= inv;
  }
}

/** Value at quantile q ∈ [0, 1] of `values` (exact for small inputs, strided sample for large ones). */
export function quantile(values: ArrayLike<number>, q: number, maxSamples = 200_000): number {
  const n = values.length;
  if (n === 0) return 0;
  const stride = Math.max(1, Math.floor(n / maxSamples));
  const sample = new Float32Array(Math.ceil(n / stride));
  for (let i = 0, j = 0; i < n; i += stride, j++) sample[j] = values[i];
  sample.sort();
  const pos = Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))));
  return sample[pos];
}

/**
 * Bins whose loudness is far below the song's loud parts count as silence. Silence has no
 * meaningful pitch or timbre, so its feature vectors are unreliable.
 */
export function silenceMask(rms: Float32Array, relativeDb = -50, absoluteFloor = 1e-4): Uint8Array {
  const ref = quantile(rms, 0.95);
  const threshold = Math.max(absoluteFloor, ref * Math.pow(10, relativeDb / 20));
  const mask = new Uint8Array(rms.length);
  for (let i = 0; i < rms.length; i++) mask[i] = rms[i] < threshold ? 1 : 0;
  return mask;
}
