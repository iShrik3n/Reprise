/**
 * Pure mapping between image coordinates and song time. No DOM, so it's unit-tested.
 * Coordinates are fractions of the image side (0 = top/left, 1 = bottom/right).
 */
import type { RenderMode } from '../render/painters';

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const clamp01 = (f: number) => (f < 0 ? 0 : f > 1 ? 1 : f);

/** Fraction along an axis → seconds, interpolating within the time bin it falls in. */
export function timeAtFraction(edges: ArrayLike<number>, f: number): number {
  const n = edges.length - 1;
  const x = clamp01(f) * n;
  const b = Math.min(n - 1, Math.floor(x));
  return edges[b] + (x - b) * (edges[b + 1] - edges[b]);
}

/** Seconds → fraction along an axis (inverse of timeAtFraction). */
export function fractionAtTime(edges: ArrayLike<number>, t: number): number {
  const n = edges.length - 1;
  if (t <= edges[0]) return 0;
  if (t >= edges[n]) return 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const width = edges[lo + 1] - edges[lo];
  return (lo + (width > 0 ? (t - edges[lo]) / width : 0)) / n;
}

export interface PointInfo {
  /** Human-readable description for the hover tooltip. */
  label: string;
  /** Where a click here should seek to (seconds). */
  seek: number;
  /** The two moments being compared (seconds); `b` is null outside the lag triangle. */
  a: number;
  b: number | null;
}

/**
 * What does the pixel at (fx, fy) mean?
 *  square modes: row fy is moment a, column fx is moment b → "a ↔ b"; clicking seeks to b.
 *  lag mode:     column fx is time t, height above the bottom is the lag ℓ → compares t with t − ℓ.
 */
export function describePoint(mode: RenderMode, edges: ArrayLike<number>, fx: number, fy: number): PointInfo {
  if (mode === 'lag') {
    const t = timeAtFraction(edges, fx);
    const duration = edges[edges.length - 1];
    const lag = clamp01(1 - fy) * duration;
    const echo = t - lag;
    if (echo < 0) return { label: `${formatTime(t)} · before the start`, seek: t, a: t, b: null };
    return {
      label: `${formatTime(t)} · echo of ${formatTime(echo)} (lag ${formatTime(lag)})`,
      seek: t,
      a: t,
      b: echo,
    };
  }
  const a = timeAtFraction(edges, fy);
  const b = timeAtFraction(edges, fx);
  return { label: `${formatTime(a)} ↔ ${formatTime(b)}`, seek: b, a, b };
}
