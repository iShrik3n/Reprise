/** Remembers the viewer's last choices in localStorage. Storage may be unavailable (private mode, blocked), so every access is guarded. */
import { WEIGHT_PRESETS, type WeightPreset } from '../analysis/types';
import { PALETTES, type PaletteId } from '../color/palettes';
import { RENDER_MODES, type RenderMode } from '../render/painters';

export interface Settings {
  mode: RenderMode;
  palette: PaletteId;
  enhance: boolean;
  preset: WeightPreset;
}

const KEY = 'reprise.settings.v1';
export const DEFAULT_SETTINGS: Settings = { mode: 'bloom', palette: 'spectrum', enhance: true, preset: 'blend' };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      mode: RENDER_MODES.includes(raw.mode as RenderMode) ? (raw.mode as RenderMode) : DEFAULT_SETTINGS.mode,
      palette: raw.palette && raw.palette in PALETTES ? raw.palette : DEFAULT_SETTINGS.palette,
      enhance: typeof raw.enhance === 'boolean' ? raw.enhance : DEFAULT_SETTINGS.enhance,
      preset: raw.preset && raw.preset in WEIGHT_PRESETS ? raw.preset : DEFAULT_SETTINGS.preset,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not persisted; that's fine */
  }
}
