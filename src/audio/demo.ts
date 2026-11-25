/**
 * A tiny deterministic piece, synthesized from scratch, used as the built-in demo.
 *
 * Form: A B A B C A, 4 bars per section at 120 bpm (8 s each, 48 s total).
 *   A: C – Am – F – G, soft pad, plucked 8th-note arpeggio, kick/snare/hats
 *   B: E♭ – Cm – A♭ – B♭, brighter saw-like pad, 16th-note arpeggio
 *   C: breakdown, a D drone with a rising noise swell and a sparse kick
 * The repeats of A and B should show up as off-diagonal blocks and stripes.
 */
import { mulberry32 } from '../util/random';

export const DEMO_BPM = 120;
export const DEMO_SECTION_SECONDS = 8;
export const DEMO_FORM = ['A', 'B', 'A', 'B', 'C', 'A'] as const;
export type DemoSection = (typeof DEMO_FORM)[number];

const BEAT = 60 / DEMO_BPM;
const BAR = 4 * BEAT;

const CHORDS: Record<'A' | 'B', number[][]> = {
  A: [
    [60, 64, 67], // C
    [57, 60, 64], // Am
    [57, 60, 65], // F (1st inversion)
    [55, 59, 62], // G
  ],
  B: [
    [58, 63, 67], // E♭ (2nd inversion)
    [55, 60, 63], // Cm
    [56, 60, 63], // A♭
    [58, 62, 65], // B♭
  ],
};
const BASS: Record<'A' | 'B', number[]> = { A: [36, 33, 41, 43], B: [39, 36, 44, 34] };

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface ToneSpec {
  start: number;
  dur: number;
  freq: number;
  amp: number;
  /** Relative amplitudes of harmonics 1, 2, 3, … */
  harmonics: number[];
  attack: number;
  /** Exponential decay time constant while held (Infinity = sustained). */
  decay: number;
  release: number;
}

function addTone(buf: Float32Array, sr: number, s: ToneSpec): void {
  const i0 = Math.max(0, Math.floor(s.start * sr));
  const i1 = Math.min(buf.length, Math.ceil((s.start + s.dur + s.release * 5) * sr));
  const nyquist = sr / 2;
  const w = 2 * Math.PI * s.freq;
  for (let i = i0; i < i1; i++) {
    const t = i / sr - s.start;
    let env = Math.min(1, t / s.attack);
    if (Number.isFinite(s.decay)) env *= Math.exp(-t / s.decay);
    if (t > s.dur) env *= Math.exp(-(t - s.dur) / s.release);
    if (env < 1e-5) continue;
    let v = 0;
    for (let h = 0; h < s.harmonics.length; h++) {
      if (s.freq * (h + 1) >= nyquist) break;
      v += s.harmonics[h] * Math.sin(w * (h + 1) * t);
    }
    buf[i] += s.amp * env * v;
  }
}

function addKick(buf: Float32Array, sr: number, start: number, amp: number): void {
  const i0 = Math.floor(start * sr);
  const len = Math.floor(0.35 * sr);
  let phase = 0;
  for (let k = 0; k < len && i0 + k < buf.length; k++) {
    const t = k / sr;
    const f = 45 + 75 * Math.exp(-t / 0.04);
    phase += (2 * Math.PI * f) / sr;
    buf[i0 + k] += amp * Math.exp(-t / 0.12) * Math.sin(phase);
  }
}

function addNoiseHit(
  buf: Float32Array,
  sr: number,
  rand: () => number,
  start: number,
  amp: number,
  decay: number,
  highpass: boolean,
): void {
  const i0 = Math.floor(start * sr);
  const len = Math.floor(decay * 6 * sr);
  let prev = 0;
  for (let k = 0; k < len && i0 + k < buf.length; k++) {
    const n = rand() * 2 - 1;
    const v = highpass ? n - prev : n; // first difference ≈ crude high-pass
    prev = n;
    buf[i0 + k] += amp * Math.exp(-(k / sr) / decay) * v;
  }
}

function renderSection(buf: Float32Array, sr: number, rand: () => number, section: DemoSection, t0: number): void {
  if (section === 'C') {
    const dur = DEMO_SECTION_SECONDS;
    for (const m of [38, 45, 50]) {
      addTone(buf, sr, { start: t0, dur, freq: midiHz(m), amp: 0.09, harmonics: [1, 0.3, 0.1], attack: 1.5, decay: Infinity, release: 0.4 });
    }
    // Rising low-passed noise swell.
    const i0 = Math.floor(t0 * sr);
    const len = Math.floor(dur * sr);
    let lp = 0;
    for (let k = 0; k < len && i0 + k < buf.length; k++) {
      lp += 0.08 * (rand() * 2 - 1 - lp);
      const x = k / len;
      buf[i0 + k] += 0.5 * x * x * lp;
    }
    for (let bar = 0; bar < 4; bar++) addKick(buf, sr, t0 + bar * BAR, 0.5);
    return;
  }

  const bright = section === 'B';
  const padHarm = bright ? [1, 0.5, 0.33, 0.25, 0.2, 0.16] : [1, 0.25, 0.08];
  const arpHarm = bright ? [1, 0.6, 0.4, 0.2] : [1, 0.15];
  const stepsPerBar = bright ? 16 : 8;
  const arpPattern = [0, 1, 2, 3, 2, 1, 2, 3];

  for (let bar = 0; bar < 4; bar++) {
    const start = t0 + bar * BAR;
    const chord = CHORDS[section][bar];
    for (const m of chord) {
      addTone(buf, sr, { start, dur: BAR, freq: midiHz(m), amp: 0.06, harmonics: padHarm, attack: 0.15, decay: Infinity, release: 0.15 });
    }
    addTone(buf, sr, { start, dur: BAR * 0.9, freq: midiHz(BASS[section][bar]), amp: 0.22, harmonics: [1, 0.4], attack: 0.01, decay: 1.2, release: 0.1 });

    const step = BAR / stepsPerBar;
    for (let s = 0; s < stepsPerBar; s++) {
      const idx = arpPattern[s % arpPattern.length];
      const note = idx === 3 ? chord[0] + 12 : chord[idx];
      addTone(buf, sr, { start: start + s * step, dur: step, freq: midiHz(note + 12), amp: 0.07, harmonics: arpHarm, attack: 0.005, decay: 0.18, release: 0.05 });
    }

    for (let beat = 0; beat < 4; beat++) {
      const bt = start + beat * BEAT;
      if (beat % 2 === 0) addKick(buf, sr, bt, 0.55);
      else addNoiseHit(buf, sr, rand, bt, 0.22, 0.06, false);
      addNoiseHit(buf, sr, rand, bt, 0.06, 0.015, true);
      addNoiseHit(buf, sr, rand, bt + BEAT / 2, 0.05, 0.015, true);
    }
  }
}

/** Render the demo as mono samples at `sampleRate`, peak-normalized to 0.9. */
export function renderDemo(sampleRate = 22050): Float32Array<ArrayBuffer> {
  const total = DEMO_FORM.length * DEMO_SECTION_SECONDS;
  const buf = new Float32Array(Math.ceil(total * sampleRate));
  const rand = mulberry32(20261125);
  DEMO_FORM.forEach((section, k) => renderSection(buf, sampleRate, rand, section, k * DEMO_SECTION_SECONDS));
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= gain;
  return buf;
}
