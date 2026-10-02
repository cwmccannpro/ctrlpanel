// In-memory stale-while-revalidate cache for sheet reads, so revisiting a CRM
// page paints instantly from the last copy while a fresh read happens behind it.
// Lives for the page session only (nothing is persisted: it is private data).
// Keyed by spreadsheet id + tab so two pages on one spreadsheet share a copy.

const sheetData = new Map(); // `${id}\n${tab}` → { data, at }
const metas = new Map(); // id → meta
const access = new Map(); // id → 'edit' | 'view'  (learned from the first write)

const keyFor = (id, tab) => `${id}\n${tab}`;

export const getCachedSheet = (id, tab) => sheetData.get(keyFor(id, tab))?.data || null;
export const setCachedSheet = (id, tab, data) => sheetData.set(keyFor(id, tab), { data, at: Date.now() });

export const getCachedMeta = (id) => metas.get(id) || null;
export const setCachedMeta = (id, meta) => metas.set(id, meta);

export const getAccess = (id) => access.get(id) || 'unknown';
export const setAccess = (id, value) => access.set(id, value);

/** Drop everything cached for a spreadsheet (e.g. after relinking a page to another one). */
export function clearSheetCache(id) {
  for (const k of [...sheetData.keys()]) if (k.startsWith(`${id}\n`)) sheetData.delete(k);
  metas.delete(id);
  access.delete(id);
}
