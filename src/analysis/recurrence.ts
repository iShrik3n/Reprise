import type { SimilarityMatrix } from './types';

/** k-th largest value of `a` (1-based k), by in-place iterative quickselect. Mutates `a`. */
export function kthLargest(a: Float32Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  const target = k - 1; // index in descending order
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] > pivot) i++;
      while (a[j] < pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  return a[target];
}

/**
 * Recurrence plot: R[i][j] = 1 when j is among i's closest `fraction` of moments AND i is
 * among j's (mutual nearest neighbors, which keeps R symmetric). A per-row threshold, rather
 * than one global cut-off, lets quiet or sparse passages leave their own marks instead of
 * vanishing next to dense, loud ones.
 */
export function recurrencePlot(s: SimilarityMatrix, fraction = 0.08): Uint8Array {
  const n = s.size;
  const k = Math.max(1, Math.min(n, Math.ceil(fraction * n)));
  const thresholds = new Float32Array(n);
  const row = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    row.set(s.data.subarray(i * n, (i + 1) * n));
    thresholds[i] = kthLargest(row, k);
  }
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const ti = thresholds[i];
    for (let j = i; j < n; j++) {
      const v = s.data[i * n + j];
      const r = v >= ti && v >= thresholds[j] ? 1 : 0;
      out[i * n + j] = r;
      out[j * n + i] = r;
    }
  }
  return out;
}
