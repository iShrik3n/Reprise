/**
 * Chroma: fold spectral energy onto the 12 pitch classes (C, C♯, …, B).
 *
 * Instead of folding every FFT bin (which smears energy into neighboring pitch classes,
 * because at low frequencies the window's main lobe is wider than a semitone), we take
 * only local spectral peaks and refine each peak's frequency by fitting a parabola through
 * the log-power of the peak bin and its two neighbors. The refined frequency becomes a
 * fractional MIDI pitch m = 69 + 12·log2(f / 440), and the peak's magnitude is split
 * linearly between the two nearest semitones.
 */

export const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

export interface ChromaConfig {
  binHz: number;
  kMin: number;
  kMax: number;
  /** Peaks quieter than this fraction of the frame's loudest peak (in power) are ignored. */
  relFloor: number;
}

export function chromaConfig(frameSize: number, sampleRate: number, fMin = 55, fMax = 5000): ChromaConfig {
  const binHz = sampleRate / frameSize;
  return {
    binHz,
    kMin: Math.max(1, Math.ceil(fMin / binHz)),
    kMax: Math.min(frameSize / 2 - 1, Math.floor(fMax / binHz)),
    relFloor: 1e-5, // −50 dB
  };
}

/** Accumulate chroma (12 values) from a power spectrum into out[outOffset … outOffset+11]. */
export function chromaFromPower(power: Float64Array, cfg: ChromaConfig, out: Float32Array, outOffset = 0): void {
  for (let p = 0; p < 12; p++) out[outOffset + p] = 0;
  const { binHz, kMin, kMax } = cfg;

  let maxP = 0;
  for (let k = kMin; k <= kMax; k++) if (power[k] > maxP) maxP = power[k];
  if (maxP <= 0) return;
  const floor = maxP * cfg.relFloor;

  for (let k = kMin; k <= kMax; k++) {
    const p = power[k];
    if (p <= floor || p <= power[k - 1] || p < power[k + 1]) continue;
    // Parabolic interpolation on log power → fractional bin offset δ ∈ [−½, ½].
    const a = Math.log(power[k - 1] + 1e-30);
    const b = Math.log(p);
    const c = Math.log(power[k + 1] + 1e-30);
    const denom = a - 2 * b + c;
    const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const freq = (k + delta) * binHz;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const lo = Math.floor(midi);
    const wHi = midi - lo;
    const pcLo = ((lo % 12) + 12) % 12;
    const mag = Math.sqrt(p);
    out[outOffset + pcLo] += mag * (1 - wHi);
    out[outOffset + ((pcLo + 1) % 12)] += mag * wHi;
  }
}
