import { describe, expect, it } from 'vitest';
import { parseYouTubeId } from '../src/util/youtube';

// Same cases as server/test_reprise_api.py, so the two parsers can't drift apart.
describe('parseYouTubeId', () => {
  const vid = 'dQw4w9WgXcQ';

  it('accepts the common link shapes', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${vid}`,
      `https://youtube.com/watch?v=${vid}&t=42s&list=PL123`,
      `http://m.youtube.com/watch?feature=share&v=${vid}`,
      `https://music.youtube.com/watch?v=${vid}&si=abc`,
      `https://youtu.be/${vid}?si=xyz`,
      `https://www.youtube.com/shorts/${vid}`,
      `https://www.youtube.com/live/${vid}?feature=share`,
      `https://www.youtube-nocookie.com/embed/${vid}`,
      `youtube.com/watch?v=${vid}`,
      `  https://YOUTU.BE/${vid}  `,
    ]) {
      expect(parseYouTubeId(link), link).toBe(vid);
    }
  });

  it('rejects everything else', () => {
    for (const link of [
      '',
      'dQw4w9WgXcQ',
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://evil.com/?u=https://youtube.com/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
      'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ;rm -rf',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@channel',
      'https://youtu.be/',
      'https://www.youtube.com/watch?v=' + 'a'.repeat(600),
    ]) {
      expect(parseYouTubeId(link), link).toBeNull();
    }
  });
});
