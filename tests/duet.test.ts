import { describe, expect, it } from 'vitest';
import { duetMix, duetPair } from '../src/audio/duet';
import { describePoint } from '../src/ui/timeline';

describe('duet pair', () => {
  const song = Float64Array.from({ length: 101 }, (_, i) => i * 1.8); // 180 s

  it('orders the two compared moments earlier → later, on either side of the diagonal', () => {
    const above = describePoint('bloom', song, 118 / 180, 42 / 180); // row 0:42, column 1:58
    const below = describePoint('bloom', song, 42 / 180, 118 / 180); // the mirrored pixel
    for (const p of [above, below]) {
      const pair = duetPair(p.a, p.b)!;
      expect(pair.earlier).toBeCloseTo(42);
      expect(pair.later).toBeCloseTo(118);
    }
  });

  it('lag mode pairs t with its echo t − ℓ, and has nothing to play before the start', () => {
    const p = describePoint('lag', song, 42 / 180, 1 - 30 / 180);
    const pair = duetPair(p.a, p.b)!;
    expect(pair.earlier).toBeCloseTo(12);
    expect(pair.later).toBeCloseTo(42);
    const empty = describePoint('lag', song, 10 / 180, 0.2);
    expect(duetPair(empty.a, empty.b)).toBeNull();
  });
});

describe('duet mix law', () => {
  it('center: both voices at equal power, spread left/right but not hard-panned', () => {
    const m = duetMix(0);
    expect(m.gainEarlier).toBeCloseTo(Math.SQRT1_2);
    expect(m.gainLater).toBeCloseTo(Math.SQRT1_2);
    expect(m.panEarlier).toBeCloseTo(-0.8);
    expect(m.panLater).toBeCloseTo(0.8);
  });

  it('ends: one voice alone, centered', () => {
    const left = duetMix(-1);
    expect(left.gainEarlier).toBeCloseTo(1);
    expect(left.gainLater).toBeCloseTo(0);
    expect(left.panEarlier).toBeCloseTo(0);
    const right = duetMix(1);
    expect(right.gainLater).toBeCloseTo(1);
    expect(right.gainEarlier).toBeCloseTo(0);
    expect(right.panLater).toBeCloseTo(0);
  });

  it('keeps loudness constant (equal power) and crossfades monotonically', () => {
    let prev = duetMix(-1);
    for (let k = -20; k <= 20; k++) {
      const m = duetMix(k / 20);
      expect(m.gainEarlier ** 2 + m.gainLater ** 2).toBeCloseTo(1, 9);
      expect(m.gainLater).toBeGreaterThanOrEqual(prev.gainLater - 1e-12);
      prev = m;
    }
    expect(duetMix(5)).toEqual(duetMix(1)); // clamped
  });
});
