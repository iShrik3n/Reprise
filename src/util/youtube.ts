/**
 * Recognize YouTube video links. Mirrors parse_video_id in server/reprise_api.py; the server
 * re-validates, so this exists only to give instant feedback and to spot links in pastes/drops.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);
const PATH_ID = /^\/(?:shorts|live|embed|v)\/([^/]+)/;

export function parseYouTubeId(text: string): string | null {
  let s = (text ?? '').trim();
  if (!s || s.length > 500) return null;
  if (!s.includes('://')) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !HOSTS.has(host)) return null;
  let candidate = '';
  if (host === 'youtu.be') candidate = url.pathname.replace(/^\/+/, '').split('/')[0];
  else if (url.pathname === '/watch') candidate = url.searchParams.get('v') ?? '';
  else candidate = PATH_ID.exec(url.pathname)?.[1] ?? '';
  return VIDEO_ID.test(candidate) ? candidate : null;
}
