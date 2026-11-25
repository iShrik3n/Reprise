/** Turn an export payload into a downloadable poster PNG. */
import type { RenderPayload } from '../worker/protocol';

export const POSTER_SIZE = 4096; // Safari's canvas limit is 4096² (16.7 M pixels)

export function posterFilename(title: string, mode: string, palette: string): string {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'song';
  return `reprise-${slug}-${mode}-${palette}.png`;
}

/**
 * Draw the payload at `target`×`target` and save it. A native-resolution payload is written
 * as-is; a smaller one (short songs have fewer frames than poster pixels) is upscaled, with
 * smoothing for the painterly modes and hard edges for the print.
 */
export async function savePoster(payload: RenderPayload, target: number, filename: string): Promise<void> {
  const src = document.createElement('canvas');
  src.width = src.height = payload.size;
  src.getContext('2d')!.putImageData(new ImageData(payload.rgba, payload.size, payload.size), 0, 0);

  let out = src;
  if (payload.size !== target) {
    out = document.createElement('canvas');
    out.width = out.height = target;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = payload.mode !== 'print';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, target, target);
  }

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
