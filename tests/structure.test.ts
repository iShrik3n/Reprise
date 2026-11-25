/**
 * The core promise of the picture: repetition → diagonals at the repeat interval,
 * and no repetition → no structure.
 */
import { describe, expect, it } from 'vitest';
import { lagProfile, strongestLag } from '../src/analysis/lag';
import { analyze } from '../src/analysis/pipeline';
import { WEIGHT_PRESETS, type AnalysisResult, type WeightPreset } from '../src/analysis/types';
import { mulberry32 } from '../src/util/random';
import { midiHz, repeat, sine, SR, whiteNoise } from './helpers/signals';

/** A random little melody: notes of random pitch, length and brightness. */
function randomMelody(seconds: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * SR));
  let t = 0;
  while (t < seconds) {
    const dur = 0.15 + rand() * 0.3;
    const f = midiHz(48 + Math.floor(rand() * 36));
    const harmonics = 1 + Math.floor(rand() * 5);
    const i0 = Math.round(t * SR);
    const i1 = Math.min(out.length, Math.round((t + dur) * SR));
    for (let i = i0; i < i1; i++) {
      const u = (i - i0) / SR;
      let v = 0;
      for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * f * h * u) / h;
      out[i] = 0.3 * v * Math.exp(-u / 0.25);
    }
    t += dur;
  }
  return out;
}

const MAX_BINS = 512;

/**
 * Standard deviation of S away from the main diagonal (lags ≥ minLag). Lag-peak heights are
 * judged in these units, because the three feature modes have very different raw ranges
 * (chroma of noise spans ~0.003, z-scored MFCC spans ~0.3).
 */
function offDiagonalSd(r: AnalysisResult, minLag: number): number {
  const { data, size } = r.similarity;
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let i = 0; i < size; i++) {
    for (let j = i + minLag; j < size; j++) {
      const v = data[i * size + j];
      s += v;
      s2 += v * v;
      n++;
    }
  }
  const mean = s / n;
  return Math.sqrt(Math.max(1e-12, s2 / n - mean * mean));
}

function run(signal: Float32Array, preset: WeightPreset): AnalysisResult {
  return analyze(signal, SR, { maxBins: MAX_BINS, weights: WEIGHT_PRESETS[preset] });
}

/** Smallest lag (≥ minSeconds) whose lag-profile value reaches 70% of the way from median to max. */
function firstRepeat(r: AnalysisResult, minSeconds = 1) {
  const secondsPerBin = r.duration / r.size;
  const profile = lagProfile(r.similarity);
  const minLag = Math.ceil(minSeconds / secondsPerBin);
  const { prominence, value } = strongestLag(profile, minLag, Math.floor(r.size * 0.75));
  const threshold = value - 0.3 * prominence;
  let lag = minLag;
  while (profile[lag] < threshold) lag++;
  // Climb to the local maximum of that first peak.
  while (profile[lag + 1] > profile[lag]) lag++;
  return { seconds: lag * secondsPerBin, prominence: prominence / offDiagonalSd(r, minLag), secondsPerBin };
}

describe('repetition shows up as diagonals at the repeat lag', () => {
  const cases: Array<[string, Float32Array, number, WeightPreset]> = [
    ['a random melody repeating every 3.7 s (harmony)', repeat(randomMelody(3.7, 11), 30), 3.7, 'harmony'],
    ['a random melody repeating every 3.7 s (both)', repeat(randomMelody(3.7, 11), 30), 3.7, 'blend'],
    ['frozen noise repeating every 2.3 s (timbre)', repeat(whiteNoise(2.3, 5), 24), 2.3, 'timbre'],
  ];

  for (const [name, signal, period, preset] of cases) {
    it(name, () => {
      const r = run(signal, preset);
      const found = firstRepeat(r);
      expect(Math.abs(found.seconds - period)).toBeLessThanOrEqual(1.5 * found.secondsPerBin);
      expect(found.prominence).toBeGreaterThan(1.5); // in off-diagonal standard deviations
    });
  }
});

describe('no repetition → no structure', () => {
  for (const preset of ['harmony', 'timbre', 'blend'] as const) {
    it(`white noise has a flat lag profile (${preset})`, () => {
      const r = run(whiteNoise(30, 99), preset);
      const profile = lagProfile(r.similarity);
      const minLag = Math.ceil(1 / (r.duration / r.size));
      const { prominence } = strongestLag(profile, minLag, Math.floor(r.size * 0.75));
      expect(prominence / offDiagonalSd(r, minLag)).toBeLessThan(0.5);
    });
  }

  it('a steady tone is uniformly self-similar (one block, no lines)', () => {
    const r = run(sine(440, 10), 'harmony');
    const { data, size } = r.similarity;
    // Ignore the zero-padded first/last few bins.
    for (let i = 8; i < size - 8; i += 13) for (let j = 8; j < size - 8; j += 11) expect(data[i * size + j]).toBeGreaterThan(0.98);
  });
});

describe('features separate what they should', () => {
  // A3 sine, A3 sawtooth-ish, D4 sine: 4 s each, repeated twice.
  const seg = (f: number, harmonics: number) => {
    const out = new Float32Array(4 * SR);
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      for (let h = 1; h <= harmonics; h++) v += Math.sin((2 * Math.PI * f * h * i) / SR) / h;
      out[i] = 0.3 * v;
    }
    return out;
  };
  const parts = [seg(220, 1), seg(220, 12), seg(midiHz(62), 1)];
  const signal = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    signal.set(p, off);
    off += p.length;
  }

  /** Mean raw similarity between segment p and segment q (centers only). */
  const block = (r: AnalysisResult, p: number, q: number) => {
    const per = r.size / 3;
    let s = 0;
    let n = 0;
    for (let i = Math.round(p * per + per * 0.2); i < Math.round((p + 1) * per - per * 0.2); i++) {
      for (let j = Math.round(q * per + per * 0.2); j < Math.round((q + 1) * per - per * 0.2); j++) {
        s += r.similarity.data[i * r.size + j];
        n++;
      }
    }
    return s / n;
  };

  it('chroma: same pitch, different timbre stays closer than different pitch, same timbre', () => {
    const r = run(signal, 'harmony');
    expect(block(r, 0, 1)).toBeGreaterThan(block(r, 0, 2) + 0.3);
  });

  it('MFCC: same timbre, different pitch stays closer than same pitch, different timbre', () => {
    const r = run(signal, 'timbre');
    expect(block(r, 0, 2)).toBeGreaterThan(block(r, 0, 1) + 0.3);
  });
});
