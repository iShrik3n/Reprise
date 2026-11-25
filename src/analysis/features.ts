import { chromaConfig, chromaFromPower } from './chroma';
import { hannWindow, RealFFT } from './fft';
import { frameCount, readFrame } from './framing';
import type { FrameFeatures, FrameParams, ProgressFn } from './types';

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
  const chroma12 = chromaConfig(frameSize, sampleRate);

  const raw = new Float64Array(frameSize);
  const windowed = new Float64Array(frameSize);
  const re = new Float64Array(fft.bins);
  const im = new Float64Array(fft.bins);
  const power = new Float64Array(fft.bins);

  const chroma = new Float32Array(frames * 12);
  const rms = new Float32Array(frames);

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
    chromaFromPower(power, chroma12, chroma, t * 12);
    if (onProgress && t % reportEvery === 0) onProgress('analyzing', t / frames);
  }
  onProgress?.('analyzing', 1);

  return {
    sampleRate,
    frameSize,
    hopSize,
    frameCount: frames,
    chroma: { data: chroma, rows: frames, dims: 12 },
    rms,
  };
}
