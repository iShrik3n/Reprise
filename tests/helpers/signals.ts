import { mulberry32 } from '../../src/util/random';

export const SR = 22050;

export function sine(freq: number, seconds: number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

export function whiteNoise(seconds: number, seed = 1, sr = SR, amp = 0.3): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * (rand() * 2 - 1);
  return out;
}

/** Tile `pattern` until the result is `seconds` long. */
export function repeat(pattern: Float32Array, seconds: number, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = pattern[i % pattern.length];
  return out;
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
