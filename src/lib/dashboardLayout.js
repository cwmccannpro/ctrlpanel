// Pure layout rules for the dashboard canvas (no React, no DOM), so they can be unit-tested.
//
// The dashboard is a horizontally extensible canvas: any number of columns (up to MAX_COLS),
// each with its own width in pixels, scrolled sideways (middle-click drag, Shift+wheel,
// trackpad or the arrow buttons). A column's width is a MINIMUM: when the columns don't fill
// the screen they grow proportionally to fill it, and when they overflow the canvas scrolls.
//
// Saved shape (user_settings.dashboard_widgets):
//   v7: { v: 7, widths: [px, …], columns: [[{ uid, id, cfg, h }, …], …],
//         configs?: [{ id, name, widths, columns }], active?: id|null }   (saved layouts, see below)
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

const serializeColumns = (columns) => columns.map((col) => col.map(({ uid, id, cfg, h }) => ({ uid, id, cfg, h })));

/**
 * The payload saved to user_settings.dashboard_widgets. `configs` / `active` (saved layouts)
 * are only written when given, so a dashboard without saved layouts keeps the plain v7 shape.
 */
export function serializeLayout(columns, widths, { configs, active } = {}) {
  const out = {
    v: LAYOUT_VERSION,
    widths: normalizeWidths(widths, columns.length),
    columns: serializeColumns(columns),
  };
  if (Array.isArray(configs) && configs.length) {
    out.configs = configs.map((c) => ({
      id: c.id,
      name: c.name,
      widths: normalizeWidths(c.widths, c.columns.length),
      columns: serializeColumns(c.columns),
    }));
    out.active = configs.some((c) => c.id === active) ? active : null;
  }
  return out;
}

/* ---------------- saved layouts ("configurations") ----------------
   Named copies of the whole layout, shown as buttons in the dashboard header. One may be
   active: the live layout is that configuration, and edits made in Customize are written
   back to it when you press Done (or forked off with "Save as new").
   Saved inside dashboard_widgets: { …v7, configs: [{ id, name, widths, columns }], active }. */

export const MAX_CONFIGS = 8;
export const CONFIG_NAME_MAX = 24;

/** Trim, collapse whitespace and cap the length. Empty string means "no usable name". */
export const cleanConfigName = (name) =>
  String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, CONFIG_NAME_MAX).trim();

/**
 * Stored configs → a clean list. Panel ids are checked by the caller's `cleanColumn` (which knows
 * the panel registry); this keeps only well-formed entries, unique ids, ≤ MAX_CONFIGS.
 */
export function normalizeConfigs(list, cleanColumn = (c) => (Array.isArray(c) ? c : [])) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (out.length >= MAX_CONFIGS) break;
    if (!c || typeof c.id !== 'string' || !c.id || seen.has(c.id) || !Array.isArray(c.columns) || !c.columns.length) continue;
    const name = cleanConfigName(c.name);
    if (!name) continue;
    seen.add(c.id);
    const columns = c.columns.slice(0, MAX_COLS).map(cleanColumn);
    out.push({ id: c.id, name, columns, widths: normalizeWidths(c.widths, columns.length) });
  }
  return out;
}

/** Add a configuration (the given layout under a new id). No-op when full or the name is empty. */
export function addConfig(configs, name, columns, widths, id) {
  const clean = cleanConfigName(name);
  if (!clean || configs.length >= MAX_CONFIGS) return { configs, id: null };
  const newId = id || `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    configs: [...configs, { id: newId, name: clean, columns, widths: normalizeWidths(widths, columns.length) }],
    id: newId,
  };
}

/** Overwrite one configuration's layout (the name stays). */
export const updateConfigLayout = (configs, id, columns, widths) =>
  configs.map((c) => (c.id === id ? { ...c, columns, widths: normalizeWidths(widths, columns.length) } : c));

/** Rename; an empty name leaves it unchanged. */
export function renameConfig(configs, id, name) {
  const clean = cleanConfigName(name);
  return clean ? configs.map((c) => (c.id === id ? { ...c, name: clean } : c)) : configs;
}

export const removeConfig = (configs, id) => configs.filter((c) => c.id !== id);

/** Move a configuration one place left (−1) or right (+1) in the header. */
export function moveConfig(configs, id, dir) {
  const i = configs.findIndex((c) => c.id === id);
  const to = i + dir;
  if (i === -1 || to < 0 || to >= configs.length) return configs;
  const next = [...configs];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
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
