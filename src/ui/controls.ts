/** Small, text-only controls: segmented switches, palette swatches, a toggle. */
import { lchToCss } from '../color/oklab';
import { PALETTE_ORDER, PALETTES, type PaletteId } from '../color/palettes';

export interface SwitchOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** A row of text buttons where exactly one is pressed. Returns a setter to sync the selection. */
export function segmented<T extends string>(
  root: HTMLElement,
  options: SwitchOption<T>[],
  initial: T,
  onChange: (value: T) => void,
): (value: T) => void {
  const buttons = options.map((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.label;
    if (opt.title) b.title = opt.title;
    b.dataset.value = opt.value;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      set(opt.value);
      onChange(opt.value);
    });
    root.append(b);
    return b;
  });
  const set = (value: T) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
  set(initial);
  return set;
}

/** Round swatches previewing each palette: its background ringed by three of its colors. */
export function paletteSwatches(root: HTMLElement, initial: PaletteId, onChange: (id: PaletteId) => void): (id: PaletteId) => void {
  const buttons = PALETTE_ORDER.map((id) => {
    const p = PALETTES[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = p.name;
    b.setAttribute('aria-label', `${p.name} palette`);
    b.dataset.value = id;
    const stops = [0.02, 0.3, 0.62].map((h) => lchToCss(p.color(h, 0.9, 0.7)));
    b.style.background = `conic-gradient(${stops[0]} 0 33%, ${stops[1]} 0 66%, ${stops[2]} 0)`;
    b.style.setProperty('--swatch-bg', lchToCss(p.background));
    b.addEventListener('click', () => {
      set(id);
      onChange(id);
    });
    root.append(b);
    return b;
  });
  const set = (id: PaletteId) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === id)));
  set(initial);
  return set;
}

export function toggle(button: HTMLButtonElement, initial: boolean, onChange: (on: boolean) => void): void {
  button.setAttribute('aria-pressed', String(initial));
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
}
