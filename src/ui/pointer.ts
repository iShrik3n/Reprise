/**
 * Unified mouse / pen / touch handling for the artwork:
 *   mouse & pen: move = hover, click = tap
 *   touch:       short tap = tap, long press (then drag) = hover, release = leave
 */
export interface PointerHandlers {
  hover(clientX: number, clientY: number): void;
  leave(): void;
  /** `shift` is true for shift-click (mouse/pen). */
  tap(clientX: number, clientY: number, shift: boolean): void;
}

const LONG_PRESS_MS = 380;
const TAP_SLOP_PX = 8;

export function attachPointer(el: HTMLElement, h: PointerHandlers): void {
  let down: { x: number; y: number; id: number; type: string } | null = null;
  let longPress = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
    longPress = false;
    if (e.pointerType === 'touch') {
      el.setPointerCapture(e.pointerId);
      timer = setTimeout(() => {
        longPress = true;
        if (down) h.hover(down.x, down.y);
      }, LONG_PRESS_MS);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') {
      h.hover(e.clientX, e.clientY);
      return;
    }
    if (!down || down.id !== e.pointerId) return;
    if (longPress) h.hover(e.clientX, e.clientY);
    else if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX) clearTimeout(timer);
  });

  el.addEventListener('pointerup', (e) => {
    clearTimeout(timer);
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const wasLong = longPress;
    down = null;
    longPress = false;
    if (wasLong) h.leave();
    else if (moved <= TAP_SLOP_PX) h.tap(e.clientX, e.clientY, e.shiftKey);
  });

  el.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    down = null;
    longPress = false;
    h.leave();
  });

  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') h.leave();
  });
}
