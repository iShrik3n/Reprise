/**
 * MFCC: log mel energies → DCT-II. The low-order coefficients describe the overall
 * shape of the spectral envelope (bright vs dark, hollow vs full), i.e. timbre,
 * largely independently of which notes are being played.
 * Coefficient 0 is just overall loudness, so it is dropped (we track RMS separately).
 */
import { applyFilterbank, melFilterbank, type MelFilterbank } from './mel';

/** Orthonormal DCT-II matrix, rows = output coefficients 0..nOut-1. */
export function dctMatrix(nIn: number, nOut: number): Float64Array[] {
  const rows: Float64Array[] = [];
  for (let k = 0; k < nOut; k++) {
    const s = k === 0 ? Math.sqrt(1 / nIn) : Math.sqrt(2 / nIn);
    const row = new Float64Array(nIn);
    for (let n = 0; n < nIn; n++) row[n] = s * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * nIn));
    rows.push(row);
  }
  return rows;
}

export class MfccExtractor {
  readonly coeffs: number;
  private readonly fb: MelFilterbank;
  private readonly dct: Float64Array[];
  private readonly mel: Float64Array;

  /** Produces coefficients 1..coeffs (c0 dropped). */
  constructor(frameSize: number, sampleRate: number, bands = 40, coeffs = 13) {
    this.coeffs = coeffs;
    this.fb = melFilterbank(frameSize, sampleRate, bands);
    this.dct = dctMatrix(bands, coeffs + 1);
    this.mel = new Float64Array(bands);
  }

  compute(power: Float64Array, out: Float32Array, offset = 0): void {
    const { mel, dct } = this;
    applyFilterbank(power, this.fb, mel);
    for (let b = 0; b < mel.length; b++) mel[b] = Math.log(mel[b] + 1e-10);
    for (let k = 1; k <= this.coeffs; k++) {
      const row = dct[k];
      let acc = 0;
      for (let b = 0; b < mel.length; b++) acc += row[b] * mel[b];
      out[offset + k - 1] = acc;
    }
  }
}
