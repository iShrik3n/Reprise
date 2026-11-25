import { describe, expect, it } from 'vitest';
import { binFeatures } from '../src/analysis/pipeline';
import { extractFeatures } from '../src/analysis/features';
import { DEFAULT_OPTIONS } from '../src/analysis/types';
import { fifthsHue, fifthsPosition, frameColors, frameDescriptors, relativeDescriptors } from '../src/color/frameColor';
import { renderDemo } from '../src/audio/demo';
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

describe('relative colors', () => {
  const desc = (hue: number[], tonal = hue.map(() => 0.5)) => ({
    hue: Float32Array.from(hue),
    tonal: Float32Array.from(tonal),
    loud: Float32Array.from(hue.map(() => 0.5)),
  });
  const none = (n: number) => new Uint8Array(n);
  /** Smallest arc (degrees) containing all hues. */
  const arcOf = (h: ArrayLike<number>) => {
    const s = Array.from(h).sort((a, b) => a - b);
    let gap = 0;
    for (let k = 0; k < s.length; k++) gap = Math.max(gap, k === s.length - 1 ? s[0] + 1 - s[k] : s[k + 1] - s[k]);
    return (1 - gap) * 360;
  };

  it('spreads a one-key song (a quarter of the wheel) across most of it', () => {
    const rand = mulberry32(9);
    const hues = Array.from({ length: 300 }, () => 0.1 + 0.25 * rand());
    expect(arcOf(hues)).toBeLessThan(95);
    const rel = relativeDescriptors(desc(hues), none(300));
    expect(arcOf(rel.hue)).toBeGreaterThan(280);
    expect(arcOf(rel.hue)).toBeLessThanOrEqual(300 + 1e-3); // keeps a gap between the extremes
  });

  it('preserves the harmonic order (neighbors stay neighbors), even across the 0/1 seam', () => {
    const rand = mulberry32(10);
    const unwrapped = Array.from({ length: 200 }, () => rand() * 0.3); // 0.9 … 1.2 on the circle
    const hues = unwrapped.map((u) => (0.9 + u) % 1);
    const rel = relativeDescriptors(desc(hues), none(200)).hue;
    const order = unwrapped.map((_, i) => i).sort((a, b) => unwrapped[a] - unwrapped[b]);
    const base = rel[order[0]];
    let prev = -1;
    for (const i of order) {
      const u = (((rel[i] - base) % 1) + 1) % 1;
      expect(u).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = u;
    }
  });

  it('caps the stretch so a near-static song stays near-static', () => {
    const rand = mulberry32(11);
    const hues = Array.from({ length: 200 }, () => 0.5 + 0.02 * rand()); // 7° of wobble
    expect(arcOf(relativeDescriptors(desc(hues), none(200)).hue)).toBeLessThanOrEqual(4 * 7.2 + 0.5);
  });

  it('keeps the song centered on its typical harmony', () => {
    const rand = mulberry32(12);
    const hues = Array.from({ length: 301 }, () => 0.6 + 0.2 * rand());
    const rel = relativeDescriptors(desc(hues), none(301)).hue;
    const medianIdx = hues.map((_, i) => i).sort((a, b) => hues[a] - hues[b])[150];
    expect(hueDist(rel[medianIdx], hues[medianIdx])).toBeLessThan(1);
  });

  it('gives the most tonal moments full color without muting tonal songs', () => {
    const tonal = Array.from({ length: 100 }, (_, i) => 0.2 + 0.4 * (i / 99)); // a dense mix: 0.2–0.6
    const rel = relativeDescriptors(desc(tonal.map((_, i) => 0.1 + i / 1000), tonal), none(100));
    expect(Math.max(...rel.tonal)).toBe(1);
    rel.tonal.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(tonal[i] - 1e-6));
  });

  it('ignores silence when measuring the song, and leaves tiny inputs alone', () => {
    const rand = mulberry32(13);
    const hues = Array.from({ length: 100 }, () => 0.2 + 0.1 * rand());
    const silent = none(110);
    const withSilence = [...hues, ...Array.from({ length: 10 }, () => 0.7)];
    silent.fill(1, 100);
    const a = relativeDescriptors(desc(hues), none(100)).hue;
    const b = relativeDescriptors(desc(withSilence), silent).hue;
    for (let i = 0; i < 100; i++) expect(b[i]).toBeCloseTo(a[i], 6);
    const tiny = desc([0.1, 0.2, 0.3]);
    expect(relativeDescriptors(tiny, none(3))).toBe(tiny);
  });

  it('widens a real one-key, dense-mix signal (demo A section + noise)', () => {
    const sec = 8 * SR;
    const demoA = renderDemo(SR).subarray(0, sec);
    const rand = mulberry32(1);
    const signal = Float32Array.from({ length: 3 * sec }, (_, i) => demoA[i % sec] + 0.12 * (rand() * 2 - 1));
    const bins = binFeatures(extractFeatures(signal, SR, DEFAULT_OPTIONS), 256);
    const abs = frameDescriptors(bins);
    const rel = relativeDescriptors(abs, bins.silent);
    expect(arcOf(rel.hue)).toBeGreaterThan(arcOf(abs.hue) * 1.8);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(rel.tonal)).toBeGreaterThan(mean(abs.tonal));
  });
});
