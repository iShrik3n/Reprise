import { describe, expect, it } from 'vitest';
import { binFeatures } from '../src/analysis/pipeline';
import { extractFeatures } from '../src/analysis/features';
import { DEFAULT_OPTIONS } from '../src/analysis/types';
import { fifthsHue, fifthsPosition, frameColors, frameDescriptors } from '../src/color/frameColor';
import { encode8, labToLinear, labToRgb8, lchToLab, lchToLabInGamut, linearToLab, srgbEncode } from '../src/color/oklab';
import { PALETTE_ORDER, PALETTES } from '../src/color/palettes';
import { mulberry32 } from '../src/util/random';
import { midiHz, sine, SR, whiteNoise } from './helpers/signals';

/** Shortest distance between two hues given as fractions of a turn, in degrees. */
const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d) * 360;
};

describe('OKLab', () => {
  it('maps white and black exactly', () => {
    expect(labToRgb8(1, 0, 0)).toEqual([255, 255, 255]);
    expect(labToRgb8(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('round-trips linear sRGB', () => {
    const rand = mulberry32(3);
    for (let k = 0; k < 50; k++) {
      const rgb: [number, number, number] = [rand(), rand(), rand()];
      const back = labToLinear(...linearToLab(...rgb));
      rgb.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
    }
  });

  it('gamut mapping always lands inside sRGB and keeps lightness and hue', () => {
    const rand = mulberry32(4);
    for (let k = 0; k < 200; k++) {
      const lch: [number, number, number] = [0.05 + 0.9 * rand(), 0.4 * rand(), 360 * rand()];
      const lab = lchToLabInGamut(lch);
      for (const v of labToLinear(...lab)) {
        expect(v).toBeGreaterThanOrEqual(-1e-3);
        expect(v).toBeLessThanOrEqual(1 + 1e-3);
      }
      expect(lab[0]).toBeCloseTo(lch[0], 9);
      const c = Math.hypot(lab[1], lab[2]);
      if (c > 1e-3) {
        const ref = lchToLab([lch[0], 1, lch[2]]);
        expect((lab[1] * ref[1] + lab[2] * ref[2]) / c).toBeCloseTo(1, 6); // same direction
      }
    }
  });

  it('fast 8-bit encoder agrees with the exact sRGB curve', () => {
    for (let k = 0; k <= 1000; k++) {
      const c = k / 1000;
      expect(Math.abs(encode8(c) - Math.round(srgbEncode(c) * 255))).toBeLessThanOrEqual(1);
    }
  });
});

describe('circle of fifths', () => {
  it('places C, G, D… one step (30°) apart, and C opposite F♯', () => {
    expect(fifthsPosition(0)).toBe(0); // C
    expect(fifthsPosition(7)).toBeCloseTo(1 / 12); // G
    expect(fifthsPosition(2)).toBeCloseTo(2 / 12); // D
    expect(fifthsPosition(5)).toBeCloseTo(11 / 12); // F, one step the other way
    expect(fifthsPosition(6)).toBeCloseTo(6 / 12); // F♯, the tritone
  });

  const onePitch = (pc: number) => Array.from({ length: 12 }, (_, p) => (p === pc ? 1 : 0));

  it('harmonically related notes get neighboring hues', () => {
    expect(hueDist(fifthsHue(onePitch(0)).hue, fifthsHue(onePitch(7)).hue)).toBeCloseTo(30, 6);
    expect(hueDist(fifthsHue(onePitch(0)).hue, fifthsHue(onePitch(5)).hue)).toBeCloseTo(30, 6);
    expect(hueDist(fifthsHue(onePitch(0)).hue, fifthsHue(onePitch(6)).hue)).toBeCloseTo(180, 6);
    // C major triad (C E G) sits closer to C than to its tritone.
    const cMaj = Array.from({ length: 12 }, (_, p) => ([0, 4, 7].includes(p) ? 1 : 0));
    expect(hueDist(fifthsHue(cMaj).hue, 0)).toBeLessThan(hueDist(fifthsHue(cMaj).hue, 0.5));
  });

  it('clarity is 1 for a single note and ~0 for all twelve', () => {
    expect(fifthsHue(onePitch(3)).clarity).toBeCloseTo(1, 9);
    expect(fifthsHue(new Array(12).fill(1)).clarity).toBeLessThan(1e-9);
  });
});

describe('frame colors from real signals', () => {
  /** 2 s C4, 2 s G4, 2 s F♯4, 2 s quiet white noise, 2 s loud C4. */
  const parts = [sine(midiHz(60), 2, SR, 0.2), sine(midiHz(67), 2, SR, 0.2), sine(midiHz(66), 2, SR, 0.2), whiteNoise(2, 8, SR, 0.2), sine(midiHz(60), 2, SR, 0.6)];
  const signal = new Float32Array(parts.length * 2 * SR);
  parts.forEach((p, k) => signal.set(p, k * 2 * SR));
  const bins = binFeatures(extractFeatures(signal, SR, DEFAULT_OPTIONS), 200);
  const desc = frameDescriptors(bins);
  const at = (seconds: number) => Math.floor((seconds / bins.duration) * bins.size);

  it('C → G is a small hue step, C → F♯ a large one', () => {
    expect(hueDist(desc.hue[at(1)], desc.hue[at(3)])).toBeLessThan(45);
    expect(hueDist(desc.hue[at(1)], desc.hue[at(5)])).toBeGreaterThan(135);
  });

  it('noise is less saturated than tones', () => {
    expect(desc.tonal[at(7)]).toBeLessThan(0.3);
    expect(desc.tonal[at(1)]).toBeGreaterThan(0.7);
  });

  it('louder moments are lighter (on dark palettes)', () => {
    expect(desc.loud[at(9)]).toBeGreaterThan(desc.loud[at(1)]);
    const colors = frameColors(desc, bins.silent, PALETTES.spectrum);
    expect(colors[at(9) * 3]).toBeGreaterThan(colors[at(1) * 3]);
  });

  it('every palette produces in-gamut colors', () => {
    for (const id of PALETTE_ORDER) {
      const colors = frameColors(desc, bins.silent, PALETTES[id]);
      for (let i = 0; i < bins.size; i++) {
        for (const v of labToLinear(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])) {
          expect(v).toBeGreaterThanOrEqual(-1e-3);
          expect(v).toBeLessThanOrEqual(1 + 1e-3);
        }
      }
    }
  });
});
