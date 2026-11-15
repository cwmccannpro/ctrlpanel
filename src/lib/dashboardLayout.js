// Pure layout rules for the dashboard canvas (no React, no DOM), so they can be unit-tested.
//
// The dashboard is a horizontally extensible canvas: any number of columns (up to MAX_COLS),
// each with its own width in pixels, scrolled sideways (middle-click drag, Shift+wheel,
// trackpad or the arrow buttons). A column's width is a MINIMUM: when the columns don't fill
// the screen they grow proportionally to fill it, and when they overflow the canvas scrolls.
//
// Saved shape (user_settings.dashboard_widgets):
//   v7: { v: 7, widths: [px, …], columns: [[{ uid, id, cfg, h }, …], …] }
//   v6: { v: 6, cols: [leftPct, middlePct], columns: [3 columns] }   (migrated on load)

export const LAYOUT_VERSION = 7;
export const MAX_COLS = 12;
export const MIN_COL_W = 260;
export const MAX_COL_W = 900;
export const DEFAULT_COL_W = 280;
// Space the canvas spends on chrome between/after columns (keep in sync with .dash2-divider and .dash2::after).
export const DIVIDER_W = 16;
export const END_PAD = 6;

const num = (v) => Number(v);

export const clampWidth = (w) => {
  const n = Math.round(num(w));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_COL_W, Math.max(MIN_COL_W, n)) : DEFAULT_COL_W;
};

/** One width per column: pad with the default, trim extras, clamp each. */
export function normalizeWidths(widths, count) {
  const list = Array.isArray(widths) ? widths : [];
  return Array.from({ length: count }, (_, i) => clampWidth(list[i] ?? DEFAULT_COL_W));
}

/**
 * Migrate the old percentage layout: `cols` holds the left and middle column's share (the
 * last column took the remainder). Converted using the container's width at load time.
 */
export function widthsFromPercent(cols, count, containerWidth) {
  // Columns share what is left after the dividers, so the migrated layout fits without a scrollbar.
  const chrome = (count - 1) * DIVIDER_W + END_PAD;
  const base = num(containerWidth) > 0 ? Math.max(0, num(containerWidth) - chrome) : DEFAULT_COL_W * count;
  // A share must be a positive number: null/''/0/garbage mean "unknown", never a zero-width column.
  const share = (v) => (v === null || v === undefined || v === '' ? NaN : num(v));
  const [a, b] = Array.isArray(cols) ? cols.map(share) : [];
  const left = a > 0 ? a : 100 / count;
  const mid = b > 0 ? b : 100 / count;
  const shares = [left, mid, Math.max(0, 100 - left - mid)];
  return Array.from({ length: count }, (_, i) => clampWidth(((shares[i] ?? 100 / count) / 100) * base));
}

/** Append an empty column. No-op at MAX_COLS. */
export function addColumn(columns, widths, width = DEFAULT_COL_W) {
  if (columns.length >= MAX_COLS) return { columns, widths: normalizeWidths(widths, columns.length) };
  return {
    columns: [...columns, []],
    widths: [...normalizeWidths(widths, columns.length), clampWidth(width)],
  };
}

/**
 * Remove a column without losing its panels: they move to the previous column (or the next
 * one when removing the first). The last remaining column cannot be removed.
 */
export function removeColumn(columns, widths, index) {
  if (columns.length <= 1 || index < 0 || index >= columns.length) {
    return { columns, widths: normalizeWidths(widths, columns.length) };
  }
  const into = index > 0 ? index - 1 : 1;
  const next = columns.map((c) => [...c]);
  next[into] = index > 0 ? [...next[into], ...next[index]] : [...next[index], ...next[into]];
  next.splice(index, 1);
  const w = normalizeWidths(widths, columns.length);
  w.splice(index, 1);
  return { columns: next, widths: w };
}

/** Swap a column with its neighbour (dir −1 = left, +1 = right). */
export function moveColumn(columns, widths, index, dir) {
  const to = index + dir;
  if (to < 0 || to >= columns.length || index < 0 || index >= columns.length) {
    return { columns, widths: normalizeWidths(widths, columns.length) };
  }
  const c = [...columns];
  const w = normalizeWidths(widths, columns.length);
  [c[index], c[to]] = [c[to], c[index]];
  [w[index], w[to]] = [w[to], w[index]];
  return { columns: c, widths: w };
}

/**
 * Resize one column. Unlike `clampWidth` (which sanitises stored values, so garbage or
 * non-positive means "use the default"), a drag past the edge must pin to the nearest limit.
 */
export function setColumnWidth(widths, index, width) {
  const n = Math.round(num(width));
  if (!Number.isFinite(n)) return [...widths];
  const w = [...widths];
  w[index] = Math.min(MAX_COL_W, Math.max(MIN_COL_W, n));
  return w;
}

/** The payload saved to user_settings.dashboard_widgets. */
export function serializeLayout(columns, widths) {
  return {
    v: LAYOUT_VERSION,
    widths: normalizeWidths(widths, columns.length),
    columns: columns.map((col) => col.map(({ uid, id, cfg, h }) => ({ uid, id, cfg, h }))),
  };
}

/* ---------------- horizontal scrolling ---------------- */

/** Where the canvas should be after dragging: the content follows the pointer. */
export const panPosition = (startScroll, startPointer, pointer) => startScroll - (pointer - startPointer);

const EPS = 2;

/** Whether there is more canvas to the left / right (drives the arrow buttons). */
export function overflowInfo(scrollLeft, clientWidth, scrollWidth) {
  return {
    overflowing: scrollWidth - clientWidth > EPS,
    canLeft: scrollLeft > EPS,
    canRight: scrollLeft + clientWidth < scrollWidth - EPS,
  };
}

/** Next scrollLeft for an arrow click: one column's worth, clamped to the canvas. */
export function scrollStep(scrollLeft, clientWidth, scrollWidth, dir, step) {
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, Math.max(0, scrollLeft + dir * step));
}
