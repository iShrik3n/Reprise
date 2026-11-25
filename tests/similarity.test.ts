import { describe, expect, it } from 'vitest';
import { l2NormalizeRows } from '../src/analysis/aggregate';
import { contrastStretch, selfSimilarity, stackBlocks } from '../src/analysis/similarity';
import type { FeatureMatrix } from '../src/analysis/types';
import { mulberry32 } from '../src/util/random';

function randomRows(rows: number, dims: number, seed: number): FeatureMatrix {
  const rand = mulberry32(seed);
  const m = { data: Float32Array.from({ length: rows * dims }, () => rand() * 2 - 1), rows, dims };
  l2NormalizeRows(m);
  return m;
}

const dot = (m: FeatureMatrix, i: number, j: number) => {
  let s = 0;
  for (let d = 0; d < m.dims; d++) s += m.data[i * m.dims + d] * m.data[j * m.dims + d];
  return s;
};

describe('similarity', () => {
  const a = randomRows(40, 12, 1);
  const b = randomRows(40, 13, 2);

  it('stacked blocks give the weighted average of per-block cosines', () => {
    const s = selfSimilarity(stackBlocks([{ m: a, weight: 0.6 }, { m: b, weight: 0.4 }]));
    for (const [i, j] of [[0, 1], [5, 17], [39, 2]]) {
      expect(s.data[i * 40 + j]).toBeCloseTo(0.6 * dot(a, i, j) + 0.4 * dot(b, i, j), 5);
    }
  });

  it('zero-weight blocks are ignored; all-zero weights are an error', () => {
    const s = selfSimilarity(stackBlocks([{ m: a, weight: 1 }, { m: b, weight: 0 }]));
    expect(s.data[3 * 40 + 9]).toBeCloseTo(dot(a, 3, 9), 5);
    expect(() => stackBlocks([{ m: a, weight: 0 }])).toThrow();
  });

  it('is symmetric with unit diagonal, also with the loudness kernel', () => {
    const energyDb = Float32Array.from({ length: 40 }, (_, i) => -40 + i);
    const s = selfSimilarity(a, { energyDb, energyWeight: 0.3 });
    for (let i = 0; i < 40; i++) {
      expect(s.data[i * 40 + i]).toBeCloseTo(1, 5);
      for (let j = 0; j < 40; j++) expect(s.data[i * 40 + j]).toBe(s.data[j * 40 + i]);
    }
    // λ blends towards the kernel: equal loudness → kernel 1, so similarity rises.
    const plain = selfSimilarity(a);
    expect(s.data[1]).toBeCloseTo(0.7 * plain.data[1] + 0.3 * Math.exp(-1 / 6), 5);
  });

  it('silence matches silence and nothing else', () => {
    const silent = new Uint8Array(40);
    silent[3] = 1;
    silent[7] = 1;
    const s = selfSimilarity(a, { silent });
    expect(s.data[3 * 40 + 7]).toBe(1);
    expect(s.data[3 * 40 + 8]).toBe(0);
    expect(s.data[8 * 40 + 7]).toBe(0);
  });

  it('contrast stretch maps into [0, 1]', () => {
    const d = contrastStretch(selfSimilarity(a));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of d.data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });
});
