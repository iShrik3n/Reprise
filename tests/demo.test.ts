import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/pipeline';
import type { AnalysisResult } from '../src/analysis/types';
import { DEMO_FORM, DEMO_SECTION_SECONDS, renderDemo } from '../src/audio/demo';
import { SR } from './helpers/signals';

/** Mean raw similarity between section blocks p and q (by index into DEMO_FORM). */
function blockMean(r: AnalysisResult, p: number, q: number): number {
  const toBin = (t: number) => Math.min(r.size - 1, Math.floor((t / r.duration) * r.size));
  const margin = 0.5; // stay away from section boundaries
  const [p0, p1] = [toBin(p * DEMO_SECTION_SECONDS + margin), toBin((p + 1) * DEMO_SECTION_SECONDS - margin)];
  const [q0, q1] = [toBin(q * DEMO_SECTION_SECONDS + margin), toBin((q + 1) * DEMO_SECTION_SECONDS - margin)];
  let sum = 0;
  let count = 0;
  for (let i = p0; i < p1; i++) {
    for (let j = q0; j < q1; j++) {
      sum += r.similarity.data[i * r.size + j];
      count++;
    }
  }
  return sum / count;
}

describe('demo piece', () => {
  const samples = renderDemo(SR);
  const result = analyze(samples, SR);

  it('is deterministic and the advertised length', () => {
    expect(samples.length).toBe(DEMO_FORM.length * DEMO_SECTION_SECONDS * SR);
    expect(renderDemo(SR)).toEqual(samples);
  });

  it('repeated sections are more alike than different ones (A B A B C A)', () => {
    const aa = blockMean(result, 0, 2);
    const bb = blockMean(result, 1, 3);
    const ab = blockMean(result, 0, 1);
    const ac = blockMean(result, 0, 4);
    expect(aa).toBeGreaterThan(ab + 0.1);
    expect(bb).toBeGreaterThan(ab + 0.1);
    expect(aa).toBeGreaterThan(ac + 0.1);
  });

  it('produces a symmetric matrix with a bright diagonal', () => {
    const { data, size } = result.similarity;
    for (let k = 0; k < 500; k++) {
      const i = (k * 7919) % size;
      const j = (k * 104729) % size;
      expect(data[i * size + j]).toBe(data[j * size + i]);
    }
    for (let i = 0; i < size; i++) expect(data[i * size + i]).toBeCloseTo(1, 5);
  });
});
