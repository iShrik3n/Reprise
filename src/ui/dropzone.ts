/** Whole-window drag & drop (audio files, and links when the YouTube backend is available) plus the file picker. */
import { ACCEPTED_AUDIO } from '../audio/decode';

export interface DropHandlers {
  onFile(file: File): void;
  /** Called with dropped link text; only consulted when `acceptLinks()` is true. */
  onLink(text: string): void;
  acceptLinks(): boolean;
}

export function setupFileInput(openButton: HTMLButtonElement, input: HTMLInputElement, h: DropHandlers): void {
  input.accept = ACCEPTED_AUDIO;
  openButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) h.onFile(file);
    input.value = '';
  });

  let depth = 0; // dragenter/leave fire for every child element
  const accepts = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes('Files') || (h.acceptLinks() && types.includes('text/uri-list'));
  };
  window.addEventListener('dragenter', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) return h.onFile(file);
    const link = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (link && h.acceptLinks()) h.onLink(link.split('\n')[0].trim());
  });
}
