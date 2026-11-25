import { describe, expect, it } from 'vitest';
import { describePoint, formatTime, fractionAtTime, timeAtFraction } from '../src/ui/timeline';

/** 4 slightly uneven bins over 10 s, like real binning produces. */
const edges = Float64Array.from([0, 2.4, 5, 7.6, 10]);

describe('timeline mapping', () => {
  it('formats times like a player', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(42.9)).toBe('0:42');
    expect(formatTime(118)).toBe('1:58');
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('maps fractions to times and back', () => {
    expect(timeAtFraction(edges, 0)).toBe(0);
    expect(timeAtFraction(edges, 1)).toBe(10);
    expect(timeAtFraction(edges, 0.25)).toBeCloseTo(2.4);
    expect(timeAtFraction(edges, 0.125)).toBeCloseTo(1.2);
    for (const t of [0, 1, 2.4, 3.3, 6, 9.99, 10]) expect(timeAtFraction(edges, fractionAtTime(edges, t))).toBeCloseTo(t, 9);
  });

  it('clamps out-of-range input', () => {
    expect(timeAtFraction(edges, -0.5)).toBe(0);
    expect(timeAtFraction(edges, 1.5)).toBe(10);
    expect(fractionAtTime(edges, -3)).toBe(0);
    expect(fractionAtTime(edges, 99)).toBe(1);
  });
});

describe('describePoint', () => {
  const song = Float64Array.from({ length: 101 }, (_, i) => i * 1.8); // 180 s, 100 bins

  it('square modes compare row time with column time; click seeks to the column', () => {
    const p = describePoint('bloom', song, 118 / 180, 42 / 180);
    expect(p.label).toBe('0:42 ↔ 1:58');
    expect(p.seek).toBeCloseTo(118);
  });

  it('lag mode compares t with t − lag, and knows the empty triangle', () => {
    const p = describePoint('lag', song, 42 / 180, 1 - 30 / 180);
    expect(p.label).toBe('0:42 · echo of 0:12 (lag 0:30)');
    expect(p.seek).toBeCloseTo(42);
    expect(describePoint('lag', song, 10 / 180, 0.2).label).toBe('0:10 · before the start');
  });
});
