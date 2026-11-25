import { describe, expect, it } from 'vitest';
import { ComplexFFT, RealFFT } from '../src/analysis/fft';
import { mulberry32 } from '../src/util/random';

function naiveDft(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k < n; k++) {
    let r = 0;
    let i = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      r += x[t] * Math.cos(a);
      i += x[t] * Math.sin(a);
    }
    re.push(r);
    im.push(i);
  }
  return { re, im };
}

describe('FFT', () => {
  const rand = mulberry32(7);

  for (const n of [4, 8, 64, 256]) {
    it(`real FFT matches a naive DFT (n=${n})`, () => {
      const x = Array.from({ length: n }, () => rand() * 2 - 1);
      const ref = naiveDft(x);
      const fft = new RealFFT(n);
      const re = new Float64Array(n / 2 + 1);
      const im = new Float64Array(n / 2 + 1);
      fft.transform(x, re, im);
      for (let k = 0; k <= n / 2; k++) {
        expect(re[k]).toBeCloseTo(ref.re[k], 9);
        expect(im[k]).toBeCloseTo(ref.im[k], 9);
      }
    });
  }

  it('complex FFT matches a naive DFT on a real input', () => {
    const n = 32;
    const x = Array.from({ length: n }, () => rand() * 2 - 1);
    const ref = naiveDft(x);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new ComplexFFT(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(ref.re[k], 9);
      expect(im[k]).toBeCloseTo(ref.im[k], 9);
    }
  });

  it('satisfies Parseval: Σ|x|² = (1/n)·Σ|X|²', () => {
    const n = 1024;
    const x = Array.from({ length: n }, () => rand() * 2 - 1);
    const fft = new RealFFT(n);
    const power = new Float64Array(n / 2 + 1);
    fft.power(x, power, new Float64Array(n / 2 + 1), new Float64Array(n / 2 + 1));
    const timeEnergy = x.reduce((s, v) => s + v * v, 0);
    // Bins 1..n/2-1 appear twice in the full (Hermitian) spectrum.
    let freqEnergy = power[0] + power[n / 2];
    for (let k = 1; k < n / 2; k++) freqEnergy += 2 * power[k];
    expect(freqEnergy / n).toBeCloseTo(timeEnergy, 6);
  });

  it('rejects non-power-of-two sizes', () => {
    expect(() => new RealFFT(1000)).toThrow();
  });
});
