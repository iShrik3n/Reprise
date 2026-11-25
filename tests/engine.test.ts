import { describe, expect, it } from 'vitest';
import { WEIGHT_PRESETS } from '../src/analysis/types';
import { renderDemo } from '../src/audio/demo';
import { AnalysisEngine } from '../src/worker/engine';
import { SR } from './helpers/signals';

const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) d++;
  return d;
};

describe('AnalysisEngine (worker core)', () => {
  it('refuses to update before analyzing', () => {
    expect(() => new AnalysisEngine().update({ weights: WEIGHT_PRESETS.timbre })).toThrow();
  });

  const engine = new AnalysisEngine();
  const progress: number[] = [];
  const first = engine.analyze(renderDemo(SR), SR, { maxBins: 256 }, {}, (_s, f) => progress.push(f));

  it('analyzes and reports monotonic progress up to 1', () => {
    expect(first.size).toBe(256);
    expect(first.mode).toBe('bloom');
    expect(first.rgba.length).toBe(256 * 256 * 4);
    expect(first.binEdges.length).toBe(257);
    expect(first.binEdges[256]).toBeCloseTo(48, 3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] - 1e-9);
    expect(progress.at(-1)).toBe(1);
  });

  it('recomputes only what each change invalidates', () => {
    const palette = engine.update({ view: { palette: 'ember' } });
    expect(Object.keys(palette.timings)).toEqual(['paint']);
    expect(differing(first.rgba, palette.rgba)).toBeGreaterThan(1000);

    const mode = engine.update({ view: { mode: 'heatmap' } });
    expect(Object.keys(mode.timings)).toEqual(['paint']);

    const enhance = engine.update({ view: { enhance: false } });
    expect(Object.keys(enhance.timings).sort()).toEqual(['enhance', 'paint']);

    const weights = engine.update({ weights: WEIGHT_PRESETS.timbre });
    expect(Object.keys(weights.timings).sort()).toEqual(['enhance', 'matrix', 'paint']);
    expect(weights.timings.features).toBeUndefined(); // never re-runs the FFT pass
  });

  it('paints every mode', () => {
    for (const mode of ['bloom', 'heatmap', 'lag', 'print'] as const) {
      const p = engine.update({ view: { mode } });
      expect(p.mode).toBe(mode);
      expect(p.rgba.length).toBe(256 * 256 * 4);
    }
  });
});
