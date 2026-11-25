import { describe, expect, it } from 'vitest';
import { WEIGHT_PRESETS } from '../src/analysis/types';
import { renderDemo } from '../src/audio/demo';
import { AnalysisEngine } from '../src/worker/engine';
import { SR } from './helpers/signals';

describe('AnalysisEngine (worker core)', () => {
  it('refuses to reweight before analyzing', () => {
    expect(() => new AnalysisEngine().setWeights(WEIGHT_PRESETS.timbre)).toThrow();
  });

  it('analyzes, reports monotonic progress, and reweights from cache', () => {
    const engine = new AnalysisEngine();
    const progress: number[] = [];
    const a = engine.analyze(renderDemo(SR), SR, { maxBins: 256 }, (_s, f) => progress.push(f));

    expect(a.size).toBe(256);
    expect(a.rgba.length).toBe(256 * 256 * 4);
    expect(a.binEdges.length).toBe(257);
    expect(a.binEdges[256]).toBeCloseTo(48, 3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] - 1e-9);
    expect(progress.at(-1)).toBe(1);

    const b = engine.setWeights(WEIGHT_PRESETS.timbre);
    expect(b.size).toBe(256);
    expect(b.timings.features).toBeUndefined(); // no FFT pass on reweight
    let differs = 0;
    for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i] !== b.rgba[i]) differs++;
    expect(differs).toBeGreaterThan(1000);
  });
});
