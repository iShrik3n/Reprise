import { describe, expect, it } from 'vitest';
import { enhancePaths } from '../src/analysis/enhance';
import { kthLargest, recurrencePlot } from '../src/analysis/recurrence';
import type { SimilarityMatrix } from '../src/analysis/types';
import { labToRgb8, lchToLabInGamut } from '../src/color/oklab';
import { PALETTES } from '../src/color/palettes';
import { paintBloom, paintHeatmap, paintLag, paintPrint, rampLut } from '../src/render/painters';
import { mulberry32 } from '../src/util/random';

const N = 32;
const pal = PALETTES.spectrum;

function matrix(fn: (i: number, j: number) => number, n = N): SimilarityMatrix {
  const data = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) data[i * n + j] = fn(i, j);
  return { data, size: n };
}

/** Distinct OKLab colors per bin, cycling through hues. */
const colors = Float32Array.from({ length: N * 3 }, (_, k) => {
  const i = Math.floor(k / 3);
  return lchToLabInGamut([0.7, 0.12, (i * 47) % 360])[k % 3];
});

const px = (rgba: Uint8ClampedArray, n: number, x: number, y: number) => Array.from(rgba.subarray((y * n + x) * 4, (y * n + x) * 4 + 3));
const near = (a: number[], b: number[], tol = 2) => a.every((v, k) => Math.abs(v - b[k]) <= tol);

describe('bloom painter', () => {
  const s = matrix((i, j) => (i === j ? 1 : Math.abs(i - j) === 8 ? 0.5 : 0));
  const out = paintBloom(s, colors, pal);
  const bg = labToRgb8(...lchToLabInGamut(pal.background));

  it('dissimilar pixels are the background', () => {
    expect(near(px(out, N, 3, 20), bg)).toBe(true);
  });

  it('the diagonal is the song\'s own color timeline (plus glow)', () => {
    for (const i of [0, 9, 31]) {
      const own = labToRgb8(colors[i * 3] + pal.glow * (1 - colors[i * 3]), colors[i * 3 + 1], colors[i * 3 + 2]);
      expect(near(px(out, N, i, i), own)).toBe(true);
    }
  });

  it('partially similar pixels sit between background and the shared color', () => {
    const p = px(out, N, 10, 2);
    const sum = (v: number[]) => v[0] + v[1] + v[2];
    expect(sum(p)).toBeGreaterThan(sum(bg) + 30);
    expect(out[(2 * N + 10) * 4]).toBe(out[(10 * N + 2) * 4]); // symmetric
  });
});

describe('lag painter', () => {
  const s = matrix((i, j) => (i === j ? 1 : Math.abs(i - j) === 8 ? 1 : 0));
  const out = paintLag(s, colors, pal);
  const bg = labToRgb8(...lchToLabInGamut(pal.background));

  it('turns the diagonal at lag 8 into a horizontal line 8 rows above the bottom', () => {
    const y = N - 1 - 8;
    for (let x = 8; x < N; x++) expect(near(px(out, N, x, y), bg)).toBe(false);
    for (let x = 8; x < N; x++) expect(near(px(out, N, x, y - 1), bg)).toBe(true);
  });

  it('leaves the "before the song started" triangle empty', () => {
    expect(near(px(out, N, 0, 0), bg)).toBe(true);
    expect(near(px(out, N, 5, N - 1 - 10), bg)).toBe(true);
  });
});

describe('heatmap painter', () => {
  it('runs from the first ramp stop to the last', () => {
    const lut = rampLut(pal.ramp);
    const out = paintHeatmap(matrix((i, j) => (i === j ? 1 : 0)), pal);
    expect(px(out, N, 0, 0)).toEqual(Array.from(lut.subarray(255 * 3, 256 * 3)));
    expect(px(out, N, 1, 0)).toEqual(Array.from(lut.subarray(0, 3)));
  });
});

describe('path enhancement', () => {
  it('keeps a long diagonal stripe and dilutes an isolated spike', () => {
    const s = matrix((i, j) => (j - i === 10 ? 1 : i === 3 && j === 25 ? 1 : 0));
    const e = enhancePaths(s, 3);
    expect(e.data[12 * N + 22]).toBeCloseTo(1, 6); // middle of the stripe
    expect(e.data[3 * N + 25]).toBeLessThan(0.3); // lone spike
    expect(e.data[25 * N + 3]).toBe(e.data[3 * N + 25]); // stays symmetric
  });

  it('mix = 0 is the identity (for a symmetric matrix)', () => {
    const rand = mulberry32(1);
    const base = matrix(() => rand());
    const s = matrix((i, j) => base.data[Math.min(i, j) * N + Math.max(i, j)]);
    expect(enhancePaths(s, 4, 0).data).toEqual(s.data);
  });
});

describe('recurrence plot', () => {
  it('kthLargest agrees with sorting', () => {
    const rand = mulberry32(2);
    for (let t = 0; t < 20; t++) {
      const a = Float32Array.from({ length: 101 }, () => Math.round(rand() * 20) / 20); // with ties
      const sorted = Array.from(a).sort((x, y) => y - x);
      const k = 1 + Math.floor(rand() * 101);
      expect(kthLargest(a.slice(), k)).toBe(sorted[k - 1]);
    }
  });

  it('is symmetric, binary, sparse, and contains the diagonal', () => {
    const rand = mulberry32(5);
    const base = matrix(() => rand());
    const s = matrix((i, j) => (i === j ? 1 : (base.data[i * N + j] + base.data[j * N + i]) / 2));
    const r = recurrencePlot(s, 0.1);
    let ones = 0;
    for (let i = 0; i < N; i++) {
      expect(r[i * N + i]).toBe(1);
      for (let j = 0; j < N; j++) {
        expect(r[i * N + j]).toBe(r[j * N + i]);
        ones += r[i * N + j];
      }
    }
    expect(ones / (N * N)).toBeLessThanOrEqual(0.1 + 1 / N);
  });

  it('prints ink on paper', () => {
    const mask = new Uint8Array(N * N);
    mask[5] = 1;
    const out = paintPrint(mask, N, PALETTES.paper);
    const sum = (v: number[]) => v[0] + v[1] + v[2];
    expect(sum(px(out, N, 5, 0))).toBeLessThan(sum(px(out, N, 6, 0)) - 300);
  });
});
