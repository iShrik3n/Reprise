/**
 * Duet: hear the two moments a pixel compares at the same time.
 *
 * Pixel (X, Y) compares moment X with moment Y. A duet starts two playheads, one at the
 * earlier moment and one at the later, and lets both advance by the same N, sliding along
 * the line parallel to the diagonal through (X, Y). On a repetition stripe the two voices are
 * the same music and line up exactly; off it, they clash.
 *
 * Both voices are AudioBufferSourceNodes started on the same AudioContext clock tick, so they
 * stay sample-locked (two <audio> elements would drift into a flam).
 *
 * The pure helpers (`duetPair`, `duetMix`) have no Web Audio dependency, so they're unit-tested.
 */

/** Which two moments a pixel's info describes, ordered earlier → later. */
export interface DuetPair {
  earlier: number;
  later: number;
}

export function duetPair(a: number, b: number | null): DuetPair | null {
  if (b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { earlier: Math.min(a, b), later: Math.max(a, b) };
}

export interface DuetMix {
  gainEarlier: number;
  gainLater: number;
  panEarlier: number;
  panLater: number;
}

/** Max stereo spread. Full hard-panning of two different passages is tiring on headphones. */
const MAX_PAN = 0.8;

/**
 * Crossfade law for the mix slider m ∈ [−1, 1]: −1 = only the earlier moment, 0 = both,
 * +1 = only the later moment. Equal-power gains (g₁² + g₂² = 1) keep the loudness steady, and
 * the stereo spread narrows to zero towards either end, so a soloed voice sits in the center.
 */
export function duetMix(m: number): DuetMix {
  const t = Math.max(-1, Math.min(1, m));
  const angle = ((t + 1) * Math.PI) / 4; // 0 … π/2
  const spread = MAX_PAN * (1 - Math.abs(t));
  return { gainEarlier: Math.cos(angle), gainLater: Math.sin(angle), panEarlier: -spread, panLater: spread };
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class Duet {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferSource: Blob | null = null;
  private decoding: Promise<AudioBuffer> | null = null;
  private voices: [Voice, Voice] | null = null;
  private startedAt = 0;
  private pair: DuetPair | null = null;
  private mix = 0;
  private generation = 0;
  /** Called when a duet ends on its own (a voice reached the end of the song). */
  onEnded: (() => void) | null = null;

  /**
   * Create/resume the AudioContext. Must be called synchronously inside a user gesture
   * (browsers only allow audio to start from one).
   */
  unlock(): void {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Decode `source` at the context's rate (stereo, full quality) unless it's already cached. */
  async prepare(source: Blob): Promise<void> {
    this.unlock();
    if (this.bufferSource === source && this.buffer) return;
    if (this.bufferSource !== source) {
      this.release();
      this.bufferSource = source;
      const ctx = this.ctx!;
      this.decoding = source.arrayBuffer().then((data) => ctx.decodeAudioData(data));
    }
    const pending = this.decoding!;
    const buffer = await pending;
    if (this.decoding === pending) this.buffer = buffer;
  }

  /** Free the decoded audio (e.g. when a new song is loaded). */
  release(): void {
    this.stop();
    this.buffer = null;
    this.bufferSource = null;
    this.decoding = null;
  }

  get active(): boolean {
    return this.voices !== null;
  }

  /** Current positions of both voices (seconds), or null when not playing. */
  position(): DuetPair | null {
    if (!this.voices || !this.pair || !this.ctx) return null;
    const n = Math.max(0, this.ctx.currentTime - this.startedAt);
    return { earlier: this.pair.earlier + n, later: this.pair.later + n };
  }

  start(pair: DuetPair): void {
    if (!this.ctx || !this.buffer) throw new Error('Duet not prepared');
    this.stop();
    const ctx = this.ctx;
    const buffer = this.buffer;
    // Both voices stop together when the later one runs out of song.
    const length = buffer.duration - pair.later;
    if (length <= 0.05) return;
    const when = ctx.currentTime + 0.04;
    const make = (offset: number): Voice => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      source.connect(gain).connect(pan).connect(ctx.destination);
      source.start(when, offset, length);
      return { source, gain, pan };
    };
    this.voices = [make(pair.earlier), make(pair.later)];
    this.applyMix(true);
    this.startedAt = when;
    this.pair = pair;
    const gen = ++this.generation;
    this.voices[1].source.onended = () => {
      if (gen !== this.generation) return; // stopped or restarted meanwhile
      this.stop();
      this.onEnded?.();
    };
  }

  stop(): void {
    this.generation++;
    if (!this.voices) return;
    for (const v of this.voices) {
      try {
        v.source.stop();
      } catch {
        /* already stopped */
      }
      v.source.disconnect();
      v.gain.disconnect();
      v.pan.disconnect();
    }
    this.voices = null;
    this.pair = null;
  }

  setMix(m: number): void {
    this.mix = m;
    this.applyMix(false);
  }

  private applyMix(immediate: boolean): void {
    if (!this.voices || !this.ctx) return;
    const mix = duetMix(this.mix);
    const [earlier, later] = this.voices;
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, v: number) => {
      if (immediate) param.value = v;
      else param.setTargetAtTime(v, t, 0.03); // smooth, click-free slider moves
    };
    set(earlier.gain.gain, mix.gainEarlier);
    set(later.gain.gain, mix.gainLater);
    set(earlier.pan.pan, mix.panEarlier);
    set(later.pan.pan, mix.panLater);
  }
}
