import { describe, expect, it } from 'vitest';
import { extractFeatures } from '../src/analysis/features';
import { hzToMel, melFilterbank, melToHz } from '../src/analysis/mel';
import { dctMatrix } from '../src/analysis/mfcc';
import { DEFAULT_OPTIONS } from '../src/analysis/types';
import { sine, SR, whiteNoise } from './helpers/signals';

describe('mel filterbank', () => {
  const fb = melFilterbank(2048, SR, 40);

  it('mel ↔ Hz round-trips', () => {
    for (const f of [30, 440, 1000, 8000]) expect(melToHz(hzToMel(f))).toBeCloseTo(f, 6);
  });

  it('has 40 non-empty triangular bands with increasing centers', () => {
    expect(fb.bands).toBe(40);
    for (let b = 0; b < 40; b++) {
      const w = fb.weights[b];
      expect(w.length).toBeGreaterThan(0);
      expect(Math.max(...w)).toBeGreaterThan(0.4);
      expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...w)).toBeLessThanOrEqual(1);
      if (b > 0) expect(fb.centers[b]).toBeGreaterThan(fb.centers[b - 1]);
    }
  });

  it('bands are evenly spaced in mel', () => {
    const d0 = hzToMel(fb.centers[1]) - hzToMel(fb.centers[0]);
    const d1 = hzToMel(fb.centers[30]) - hzToMel(fb.centers[29]);
    expect(d1).toBeCloseTo(d0, 6);
  });
});

describe('DCT-II', () => {
  it('is orthonormal', () => {
    const m = dctMatrix(40, 40);
    for (let i = 0; i < 40; i += 7) {
      for (let j = 0; j < 40; j += 5) {
        let dot = 0;
        for (let k = 0; k < 40; k++) dot += m[i][k] * m[j][k];
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 9);
      }
    }
  });
});

describe('frame features', () => {
  const mid = (a: Float32Array) => Array.from(a.subarray(4, a.length - 4));

  it('RMS of a sine with amplitude a is a/√2', () => {
    const f = extractFeatures(sine(440, 1, SR, 0.5), SR, DEFAULT_OPTIONS);
    for (const v of mid(f.rms)) expect(v).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('spectral flatness: a sine is tonal (≈0), white noise is noisy (≈0.56)', () => {
    const tonal = extractFeatures(sine(440, 1), SR, DEFAULT_OPTIONS);
    const noisy = extractFeatures(whiteNoise(1), SR, DEFAULT_OPTIONS);
    for (const v of mid(tonal.flatness)) expect(v).toBeLessThan(0.01);
    for (const v of mid(noisy.flatness)) {
      expect(v).toBeGreaterThan(0.4);
      expect(v).toBeLessThan(0.75);
    }
  });

  it('MFCCs are identical for identical frames and finite everywhere', () => {
    // 5 periods per hop → every frame sees exactly the same waveform.
    const f = extractFeatures(sine((5 * SR) / DEFAULT_OPTIONS.hopSize, 1), SR, DEFAULT_OPTIONS);
    const { data, dims } = f.mfcc;
    for (const v of data) expect(Number.isFinite(v)).toBe(true);
    const a = Array.from(data.subarray(10 * dims, 11 * dims));
    const b = Array.from(data.subarray(20 * dims, 21 * dims));
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));
  });
});
