// Pure table logic for the Sheets-backed CRM view (no React, no network), so it
// can be unit-tested with `node --test`.
//
// A sheet is `{ headers: string[], rows: [{ row, cells: string[] }], truncated }`
// where `row` is the 1-based row number in Google Sheets and `cells` aligns with
// `headers`. Columns are addressed by index (header names can repeat or change).

export const PAGE_SIZE = 200;

/** Case-insensitive search across every cell + exact-value column filters ({ [colIndex]: value }). */
export function filterRows(rows, search = '', filters = {}) {
  const q = search.trim().toLowerCase();
  const active = Object.entries(filters);
  return rows.filter(
    (r) =>
      (!q || r.cells.some((v) => v.toLowerCase().includes(q))) &&
      active.every(([col, value]) => (r.cells[Number(col)] ?? '') === value)
  );
}

// "$1,200.50", "(12)", "45%", "1e3" → number; anything else → null.
function parseNumber(text) {
  const t = text.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/^\((.*)\)$/, '$1').replace(/[$€£¥,\s%]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

// Only recognisable date formats count as dates. Date.parse alone is far too
// lenient (V8 reads "item 10" as a date), so match the shape first.
const DATE_SHAPES = [
  /^\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?)?$/i, // 12/31/2026, 12/31/2026 3:30 PM
  /^\d{4}-\d{1,2}-\d{1,2}([T\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/, // 2026-12-31, 2026-12-31T10:00:00Z
  /^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/, // Dec 31, 2026
  /^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$/, // 31 Dec 2026
];
function parseDate(text) {
  const t = text.trim();
  if (!DATE_SHAPES.some((re) => re.test(t))) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** Sort by one column. Numbers and dates compare as such; blanks always sort last. */
export function sortRows(rows, col, dir = 'asc') {
  if (col == null || col < 0) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  const keyed = rows.map((r, i) => {
    const text = r.cells[col] ?? '';
    return { r, i, text, num: parseNumber(text), date: parseDate(text) };
  });
  keyed.sort((a, b) => {
    const aBlank = a.text.trim() === '';
    const bBlank = b.text.trim() === '';
    if (aBlank || bBlank) return aBlank === bBlank ? a.i - b.i : aBlank ? 1 : -1; // blanks last either way
    let cmp;
    if (a.num !== null && b.num !== null) cmp = a.num - b.num;
    else if (a.date !== null && b.date !== null) cmp = a.date - b.date;
    else cmp = a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' });
    return cmp * sign || a.i - b.i;
  });
  return keyed.map((k) => k.r);
}

/** Distinct values of a column, sorted, for the exact-value filter menus. */
export function distinctValues(rows, col) {
  return [...new Set(rows.map((r) => r.cells[col] ?? ''))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/** A clickable form of a cell: email, web link or phone number; otherwise null. */
export function cellLink(value) {
  const v = String(value ?? '').trim();
  if (!v || v.length > 300) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return { href: v, kind: 'url' };
  if (/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(v)) return { href: `mailto:${v}`, kind: 'email' };
  // A date like 2026-10-02 or 12/31/2026 has phone-number-shaped digits: rule it out first.
  const dateLike = /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v);
  const digits = (v.match(/\d/g) || []).length;
  if (!dateLike && /^\+?[\d\s().-]{7,20}$/.test(v) && digits >= 7 && digits <= 15) {
    return { href: `tel:${v.replace(/[^\d+]/g, '')}`, kind: 'phone' };
  }
  return null;
}

/* ---- Local (optimistic) edits. Each returns a new rows array. ---- */

/** Set one cell. */
export function withCell(rows, rowNumber, col, value) {
  return rows.map((r) => {
    if (r.row !== rowNumber) return r;
    const cells = [...r.cells];
    cells[col] = value;
    return { ...r, cells };
  });
}

/**
 * Remove rows by sheet row number. Rows below a deleted one move up in Google
 * Sheets, so their numbers shift down by how many deleted rows sat above them.
 */
export function withoutRows(rows, deleted) {
  const gone = [...new Set(deleted)].sort((a, b) => a - b);
  const goneSet = new Set(gone);
  return rows
    .filter((r) => !goneSet.has(r.row))
    .map((r) => ({ ...r, row: r.row - gone.filter((d) => d < r.row).length }));
}

/** Append a row (`row` is the sheet row Google reported, or just past the last known one). */
export function withAppended(rows, cells, row) {
  const next = row || (rows.length ? Math.max(...rows.map((r) => r.row)) + 1 : 2);
  return [...rows, { row: next, cells }];
}

/* ---- Safety for destructive actions ---- */

/** A stable fingerprint of a row's content. */
export const rowSignature = (cells) => JSON.stringify(cells);

/**
 * Rows in `selection` (Map of sheet row number → signature taken when selected)
 * whose content no longer matches the live sheet at that row number. Someone
 * inserting or deleting rows in Google Sheets shifts everything below, so a
 * bulk delete must re-check the selection against a fresh read first.
 */
export function staleSelection(freshRows, selection) {
  const live = new Map(freshRows.map((r) => [r.row, rowSignature(r.cells)]));
  return [...selection].filter(([row, signature]) => live.get(row) !== signature).map(([row]) => row);
}
