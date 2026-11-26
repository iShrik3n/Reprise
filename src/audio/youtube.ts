/**
 * Client for the optional Reprise API, which turns a YouTube link into an audio file.
 * The page works without it (pure static hosting): the YouTube option is shown only when
 * /api/health answers.
 */

export interface FetchedSong {
  file: File;
  title: string;
}

/** Is the YouTube backend available? Resolves false quickly when it isn't. */
export async function youtubeAvailable(timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return res.status === 504 || res.status === 502
    ? 'The server took too long to fetch this video. Try again.'
    : `The server couldn't fetch this video (HTTP ${res.status}).`;
}

/** Ask the server to fetch the video's audio, then download it as a File. */
export async function fetchYouTube(url: string, signal?: AbortSignal): Promise<FetchedSong> {
  const res = await fetch('/api/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const info = (await res.json()) as { title?: string; audio?: string };
  if (!info.audio || !info.audio.startsWith('/api/audio/')) throw new Error('The server sent an unexpected reply.');
  const audio = await fetch(info.audio, { signal });
  if (!audio.ok) throw new Error(`Couldn't download the audio (HTTP ${audio.status}).`);
  const blob = await audio.blob();
  const title = (info.title ?? 'YouTube').trim() || 'YouTube';
  return { file: new File([blob], `${title}.m4a`, { type: 'audio/mp4' }), title };
}
