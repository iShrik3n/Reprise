/**
 * Decode an audio file in the browser and return mono samples at `targetRate`.
 *
 * `decodeAudioData` resamples to its context's rate, so decoding through an
 * OfflineAudioContext created at `targetRate` gives us resampled audio for free.
 * (Decoding has to happen on the main thread: workers have no AudioContext.)
 */
export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

export async function decodeToMono(data: ArrayBuffer, targetRate: number): Promise<DecodedAudio> {
  const ctx = new OfflineAudioContext(1, 1, targetRate);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } catch (err) {
    throw new Error(
      "This browser couldn't decode that file. Try an mp3 or wav, or another browser for ogg/m4a.",
      { cause: err },
    );
  }
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const samples = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) samples[i] += ch[i];
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i++) samples[i] *= inv;
  }
  return { samples, sampleRate: buffer.sampleRate, duration: length / buffer.sampleRate };
}

export const ACCEPTED_AUDIO = '.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm,audio/*';

export function looksLikeAudio(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(file.name);
}
