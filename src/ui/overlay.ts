/**
 * Playhead and hover guides, drawn on a transparent canvas above the artwork.
 *
 * Square modes: the playhead is a cross-hair through (t, t) on the diagonal. Hovering (i, j)
 * draws guides from the point back to the two diagonal moments it compares.
 * Lag mode: the playhead is a vertical line at t. Hovering (t, ℓ) links the point to the two
 * compared moments on the bottom (lag-0) row: t, and its echo t − ℓ.
 */
import type { RenderMode } from '../render/painters';
import { describePoint, fractionAtTime } from './timeline';
import type { Stage } from './stage';

export interface OverlayState {
  mode: RenderMode;
  edges: Float64Array | null;
  /** Light artwork (paper/print) needs dark ink for the guides. */
  light: boolean;
  playhead: number | null;
  hover: { fx: number; fy: number } | null;
  /** An active duet: the clicked pixel's row/column times, its earlier/later moments, and elapsed N. */
  duet: { row0: number; col0: number; earlier0: number; later0: number; n: number } | null;
}

export class Overlay {
  readonly state: OverlayState = { mode: 'bloom', edges: null, light: false, playhead: null, hover: null, duet: null };
  private queued = false;

  constructor(private readonly stage: Stage) {}

  set(patch: Partial<OverlayState>): void {
    Object.assign(this.state, patch);
    this.request();
  }

  /** Coalesce redraws into the next animation frame. */
  request(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    const { overlay, cssSize: S, dpr } = this.stage;
    const ctx = overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const { edges, mode, playhead, hover, light, duet } = this.state;
    if (!edges) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = (a: number) => (light ? `rgba(18, 18, 24, ${a})` : `rgba(255, 246, 228, ${a})`);
    const halo = (a: number) => (light ? `rgba(255, 255, 255, ${a})` : `rgba(0, 0, 0, ${a})`);
    const line = (x0: number, y0: number, x1: number, y1: number, alpha: number, dash: number[] = [], width = 1) => {
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = ink(alpha);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    const dot = (x: number, y: number, r: number, alpha: number) => {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = halo(0.45 * alpha);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ink(alpha);
      ctx.fill();
    };
    const snap = (v: number) => Math.round(v * dpr) / dpr + 0.5 / dpr; // crisp 1-px lines

    const fr = (t: number) => fractionAtTime(edges, t) * S;

    if (duet) {
      // Both playheads advance by the same N: the marker slides parallel to the diagonal.
      const { row0, col0, earlier0, later0, n } = duet;
      const e = fr(earlier0 + n);
      const l = fr(later0 + n);
      ctx.lineCap = 'round';
      if (mode === 'lag') {
        const y = (1 - (later0 - earlier0) / edges[edges.length - 1]) * S;
        line(fr(later0), y, l, y, 0.75, [], 1.5);
        line(l, y, l, S, 0.35, [2, 3]);
        line(l, y, e, S, 0.35, [2, 3]);
        dot(e, S - 3, 3, 0.95);
        dot(l, S - 3, 3, 0.95);
        dot(l, y, 4, 1);
      } else {
        const x = fr(col0 + n);
        const y = fr(row0 + n);
        line(fr(col0), fr(row0), x, y, 0.75, [], 1.5);
        line(x, y, y, y, 0.35, [2, 3]);
        line(x, y, x, x, 0.35, [2, 3]);
        dot(e, e, 3, 0.95);
        dot(l, l, 3, 0.95);
        dot(x, y, 4, 1);
      }
    } else if (playhead !== null) {
      const p = snap(fractionAtTime(edges, playhead) * S);
      if (mode === 'lag') {
        line(p, 0, p, S, 0.35);
        dot(p, S - 3, 3, 0.95);
      } else {
        line(p, 0, p, S, 0.28);
        line(0, p, S, p, 0.28);
        dot(p, p, 3.5, 0.95);
      }
    }

    if (hover && hover.fx >= 0 && hover.fx <= 1 && hover.fy >= 0 && hover.fy <= 1) {
      const x = hover.fx * S;
      const y = hover.fy * S;
      if (mode === 'lag') {
        const info = describePoint(mode, edges, hover.fx, hover.fy);
        line(x, y, x, S, 0.5, [2, 3]);
        dot(x, S - 3, 2.5, 0.85);
        if (info.b !== null) {
          const ex = fractionAtTime(edges, info.b) * S;
          line(x, y, ex, S, 0.5, [2, 3]);
          dot(ex, S - 3, 2.5, 0.85);
        }
      } else {
        line(x, y, y, y, 0.5, [2, 3]); // along the row back to moment a on the diagonal
        line(x, y, x, x, 0.5, [2, 3]); // along the column back to moment b
        dot(y, y, 2.5, 0.85);
        dot(x, x, 2.5, 0.85);
      }
    }
  }
}
