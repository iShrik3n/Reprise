/**
 * Palettes map a frame's sound descriptors to an OKLCH color, and define the background,
 * the heatmap ramp and the print (paper/ink) colors for the alternative render modes.
 *
 * Inputs to `color`:
 *   h      position of the frame's harmony on the circle of fifths, 0..1 (0 = C, 1/12 = G, …)
 *   tonal  0 = noisy / no clear pitch, 1 = clear, sustained harmony
 *   loud   loudness percentile within the song, 0..1
 */
import type { Lch } from './oklab';

export type PaletteId = 'spectrum' | 'nocturne' | 'ember' | 'ink' | 'paper';

export interface Palette {
  id: PaletteId;
  name: string;
  background: Lch;
  color(h: number, tonal: number, loud: number): Lch;
  /** Extra lightness at very high similarity (0 = none). Only meaningful on dark backgrounds. */
  glow: number;
  /** Heatmap stops from dissimilar → similar. */
  ramp: Lch[];
  paper: Lch;
  ink: Lch;
}

/** Map the circle 0..1 onto 0..1..0, so a hue *range* still varies continuously around the circle. */
const fold = (h: number) => 1 - Math.abs(2 * (((h % 1) + 1) % 1) - 1);

export const PALETTES: Record<PaletteId, Palette> = {
  spectrum: {
    id: 'spectrum',
    name: 'Spectrum',
    background: [0.12, 0.012, 280],
    color: (h, tonal, loud) => [0.5 + 0.36 * loud, 0.035 + 0.16 * tonal, 25 + 360 * h],
    glow: 0.22,
    ramp: [
      [0.12, 0.012, 280],
      [0.3, 0.12, 300],
      [0.56, 0.18, 15],
      [0.8, 0.15, 65],
      [0.97, 0.05, 95],
    ],
    paper: [0.95, 0.012, 85],
    ink: [0.17, 0.012, 280],
  },
  nocturne: {
    id: 'nocturne',
    name: 'Nocturne',
    background: [0.11, 0.02, 265],
    color: (h, tonal, loud) => [0.42 + 0.44 * loud, 0.03 + 0.14 * tonal, 210 + 115 * fold(h)],
    glow: 0.25,
    ramp: [
      [0.11, 0.02, 265],
      [0.3, 0.1, 265],
      [0.55, 0.14, 305],
      [0.84, 0.1, 80],
      [0.97, 0.03, 90],
    ],
    paper: [0.93, 0.015, 250],
    ink: [0.25, 0.07, 265],
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    background: [0.12, 0.015, 40],
    color: (h, tonal, loud) => [0.46 + 0.42 * loud, 0.05 + 0.15 * tonal, 18 + 68 * fold(h)],
    glow: 0.2,
    ramp: [
      [0.12, 0.015, 40],
      [0.32, 0.11, 25],
      [0.6, 0.17, 45],
      [0.85, 0.12, 80],
      [0.97, 0.04, 95],
    ],
    paper: [0.94, 0.02, 75],
    ink: [0.3, 0.09, 35],
  },
  ink: {
    id: 'ink',
    name: 'Ink',
    background: [0.08, 0, 0],
    color: (_h, tonal, loud) => [0.42 + 0.54 * loud, 0.025 * tonal, 80],
    glow: 0.15,
    ramp: [
      [0.08, 0, 0],
      [1, 0, 0],
    ],
    paper: [0.98, 0, 0],
    ink: [0.1, 0, 0],
  },
  paper: {
    id: 'paper',
    name: 'Paper',
    background: [0.95, 0.012, 85],
    color: (h, tonal, loud) => [0.56 - 0.3 * loud, 0.07 + 0.14 * tonal, 25 + 360 * h],
    glow: 0,
    ramp: [
      [0.95, 0.012, 85],
      [0.76, 0.05, 60],
      [0.46, 0.08, 40],
      [0.18, 0.02, 280],
    ],
    paper: [0.95, 0.012, 85],
    ink: [0.2, 0.02, 280],
  },
};

export const PALETTE_ORDER: PaletteId[] = ['spectrum', 'nocturne', 'ember', 'ink', 'paper'];
