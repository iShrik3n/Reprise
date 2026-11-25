import { chromaConfig, chromaFromPower } from './chroma';
import { hannWindow, RealFFT } from './fft';
import { frameCount, readFrame } from './framing';
import { MfccExtractor } from './mfcc';
import { spectralFlatness } from './spectral';
import type { FrameFeatures, FrameParams, ProgressFn } from './types';

export const MFCC_COEFFS = 13;

/** Short-time analysis of a mono signal into per-frame feature vectors. */
export function extractFeatures(
  signal: Float32Array,
  sampleRate: number,
  params: FrameParams,
  onProgress?: ProgressFn,
): FrameFeatures {
  const { frameSize, hopSize } = params;
  const frames = frameCount(signal.length, hopSize);
  const fft = new RealFFT(frameSize);
  const window = hannWindow(frameSize);
  const chromaCfg = chromaConfig(frameSize, sampleRate);
  const mfccX = new MfccExtractor(frameSize, sampleRate, 40, MFCC_COEFFS);
  const binHz = sampleRate / frameSize;
  const flatMin = Math.max(1, Math.round(60 / binHz));
  const flatMax = Math.min(frameSize / 2, Math.round(Math.min(8000, sampleRate / 2) / binHz));

  const raw = new Float64Array(frameSize);
  const windowed = new Float64Array(frameSize);
  const re = new Float64Array(fft.bins);
  const im = new Float64Array(fft.bins);
  const power = new Float64Array(fft.bins);

  const chroma = new Float32Array(frames * 12);
  const mfcc = new Float32Array(frames * MFCC_COEFFS);
  const rms = new Float32Array(frames);
  const flatness = new Float32Array(frames);

  const reportEvery = Math.max(1, Math.floor(frames / 100));
  for (let t = 0; t < frames; t++) {
    readFrame(signal, t, frameSize, hopSize, raw);
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = raw[i];
      sumSq += v * v;
      windowed[i] = v * window[i];
    }
    rms[t] = Math.sqrt(sumSq / frameSize);
    fft.power(windowed, power, re, im);
    chromaFromPower(power, chromaCfg, chroma, t * 12);
    mfccX.compute(power, mfcc, t * MFCC_COEFFS);
    flatness[t] = spectralFlatness(power, flatMin, flatMax);
    if (onProgress && t % reportEvery === 0) onProgress('analyzing', t / frames);
  }
  onProgress?.('analyzing', 1);

  return {
    sampleRate,
    frameSize,
    hopSize,
    frameCount: frames,
    duration: signal.length / sampleRate,
    chroma: { data: chroma, rows: frames, dims: 12 },
    mfcc: { data: mfcc, rows: frames, dims: MFCC_COEFFS },
    rms,
    flatness,
  };
}
