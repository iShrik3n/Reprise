import { describe, expect, it } from 'vitest';
import { extractFeatures } from '../src/analysis/features';
import { DEFAULT_OPTIONS } from '../src/analysis/types';
import { midiHz, sine, SR } from './helpers/signals';

function argmax(row: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i] > row[best]) best = i;
  return best;
}

describe('chroma', () => {
  const cases: Array<[string, number, number]> = [
    ['A4 (440 Hz)', 440, 9],
    ['C4', midiHz(60), 0],
    ['G3', midiHz(55), 7],
    ['F♯5', midiHz(78), 6],
  ];

  for (const [name, freq, pc] of cases) {
    it(`a pure ${name} sine peaks at pitch class ${pc} in every frame`, () => {
      const f = extractFeatures(sine(freq, 2), SR, DEFAULT_OPTIONS);
      const { data, rows } = f.chroma;
      // Skip the zero-padded edge frames.
      for (let t = 4; t < rows - 4; t++) {
        const row = data.subarray(t * 12, t * 12 + 12);
        expect(argmax(row)).toBe(pc);
        const sorted = Array.from(row).sort((a, b) => b - a);
        expect(sorted[0]).toBeGreaterThan(3 * sorted[1]);
      }
    });
  }
});
