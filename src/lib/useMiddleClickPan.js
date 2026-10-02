import { useEffect, useRef } from 'react';
import { panPosition } from './dashboardLayout.js';

/** Nearest ancestor that actually scrolls vertically, or null. */
export function scrollParent(el) {
  let p = el?.parentElement;
  while (p) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Press the middle mouse button (wheel click) and drag to pan, like grabbing the canvas:
 * the content follows the pointer. `scrollers()` returns `{ x, y }` — the elements to scroll
 * horizontally / vertically (either may be missing) — and is read at the start of each pan,
 * so it can adapt to the current layout.
 *
 * - The press is cancelled (`preventDefault`) so the browser's own autoscroll never starts.
 * - A drag also swallows the middle-click's default "open link in new tab" (auxclick);
 *   a plain middle-click without moving is left alone.
 */
export function useMiddleClickPan(ref, scrollers) {
  const getScrollers = useRef(scrollers);
  getScrollers.current = scrollers;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let drag = null;
    let swallowAux = false;

    const end = () => {
      if (!drag) return;
      swallowAux = drag.moved;
      drag = null;
      document.body.classList.remove('is-panning');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', end);
    };
    const onMove = (e) => {
      if (!drag) return;
      if (!(e.buttons & 4)) return end(); // released outside the window
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      if (drag.x) drag.x.scrollLeft = panPosition(drag.left, drag.sx, e.clientX);
      if (drag.y) drag.y.scrollTop = panPosition(drag.top, drag.sy, e.clientY);
    };
    const onUp = (e) => {
      if (e.button === 1) end();
    };
    const onDown = (e) => {
      if (e.button !== 1) return;
      const { x, y } = getScrollers.current?.() || {};
      if (!x && !y) return;
      e.preventDefault();
      drag = { sx: e.clientX, sy: e.clientY, x, y, left: x?.scrollLeft ?? 0, top: y?.scrollTop ?? 0, moved: false };
      document.body.classList.add('is-panning');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('blur', end);
    };
    const onAux = (e) => {
      if (e.button === 1 && swallowAux) {
        e.preventDefault();
        e.stopPropagation();
      }
      swallowAux = false;
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('auxclick', onAux, true);
    return () => {
      end();
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('auxclick', onAux, true);
    };
  }, [ref]);
}
