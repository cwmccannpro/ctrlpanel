// ============================================================
// CTRLpanel — Google Sheets-backed CRM (service account auth)
//
// A CRM board can be linked to a Google Spreadsheet, which then becomes the
// source of truth: rows are read live and edits are written straight back, so
// full editing power stays in Sheets.
//
// WHY A SERVICE ACCOUNT, NOT OAUTH:
// Google restricts the Sheets scope to OAuth clients whose redirect URIs are
// all HTTPS — which rules out `http://localhost` dev entirely, project-wide.
// A service account authenticates app-to-app with a signed JWT: no redirect
// URI, no consent screen, no verification, no HTTPS requirement. The trade is
// that the user shares each spreadsheet with the service account's email
// (Viewer to read, Editor to also edit from CTRLpanel).
//
// Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (the whole downloaded key file, raw
// or base64 — one value, easiest) or GOOGLE_SERVICE_ACCOUNT_EMAIL +
// GOOGLE_SERVICE_ACCOUNT_KEY.
//
// Signing uses WebCrypto (available in Node 18+ and Cloudflare Workers), so
// this module runs unchanged in both runtimes. Env is read at call time, and
// GOOGLE_TOKEN_URL / GOOGLE_SHEETS_API_BASE exist so tests can point it at a
// fake Google.
// ============================================================

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const sheetsApi = () => process.env.GOOGLE_SHEETS_API_BASE || 'https://sheets.googleapis.com/v4/spreadsheets';

// Rows returned per read. Past this the response says `truncated: true` so the
// UI can tell the user instead of silently dropping data.
export const MAX_ROWS = 10000;
const MAX_COLS_RANGE = 'ZZ'; // 702 columns
const MAX_CELL_CHARS = 50000;

/** An error the UI can act on: `code` says what to show, `status` is the HTTP status to relay. */
export class SheetsError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
    this.status = status;
  }
}

/* ---- Credentials ---- */

/**
 * The service account from env: `{ email, key }`, `{ error }` when the value is
 * present but unusable, or null when nothing is configured.
 */
export function loadServiceAccount() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    try {
      const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (json.client_email && json.private_key) {
        return { email: String(json.client_email), key: String(json.private_key).replace(/\\n/g, '\n') };
      }
      return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key — use the key file Google downloaded.' };
    } catch {
      return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file contents (or its base64).' };
    }
  }
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  // Works for a real multi-line value and one with literal \n escapes (how it usually survives .env / secrets).
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');
  return email && key ? { email, key } : null;
}

export function sheetsReady() {
  const cfg = loadServiceAccount();
  return Boolean(cfg && !cfg.error);
}

/** The address the user must share their spreadsheets with. */
export function sheetsServiceEmail() {
  const cfg = loadServiceAccount();
  return cfg && !cfg.error ? cfg.email : '';
}

export function getSheetsStatus() {
  const cfg = loadServiceAccount();
  return {
    ready: Boolean(cfg && !cfg.error),
    serviceEmail: cfg && !cfg.error ? cfg.email : '',
    configError: cfg?.error || '',
  };
}

/* ---- Service-account JWT → access token ---- */
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pemToPkcs8(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  if (!body) throw new SheetsError('auth', 'The service account private key is empty.', 502);
  return Buffer.from(body, 'base64');
}

const tokens = new Map(); // `${email}\n${key}` → { value, exp }

/** Forget cached access tokens (tests, or after rotating the key). */
export function resetSheetsCache() {
  tokens.clear();
}

async function accessToken() {
  const cfg = loadServiceAccount();
  if (!cfg) {
    throw new SheetsError('not_configured', 'Google Sheets is not configured on the server (no service account).', 503);
  }
  if (cfg.error) throw new SheetsError('not_configured', cfg.error, 503);

  const cacheKey = `${cfg.email}\n${cfg.key}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.exp - Date.now() > 60000) return cached.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: cfg.email, scope: SCOPE, aud: tokenUrl(), iat: now, exp: now + 3600 }));
  const input = `${header}.${claim}`;

  let sig;
  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(cfg.key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  } catch (e) {
    if (e instanceof SheetsError) throw e;
    throw new SheetsError(
      'auth',
      'The service account private key could not be read. Use the "private_key" value from the JSON key file (it starts with -----BEGIN PRIVATE KEY-----).',
      502
    );
  }

  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = {};
    try { detail = JSON.parse(text); } catch { /* not JSON */ }
    const why = detail.error_description || detail.error || text.slice(0, 160);
    throw new SheetsError(
      'auth',
      /invalid_grant/i.test(detail.error || '')
        ? `Google rejected the service account key (${why}). Check the email matches the key, the key was not deleted, and this server's clock is correct.`
        : `Service account sign-in failed (${res.status}): ${why}`,
      502
    );
  }
  const t = await res.json();
  tokens.set(cacheKey, { value: t.access_token, exp: Date.now() + Number(t.expires_in || 3600) * 1000 });
  return t.access_token;
}

/** Turn a Google error response into the SheetsError that tells the user what to do. */
async function classify(res, write) {
  const text = await res.text().catch(() => '');
  let err = {};
  try { err = JSON.parse(text).error || {}; } catch { /* not JSON */ }
  const msg = String(err.message || text || '').slice(0, 300);
  const reasons = [...(err.details || []).map((d) => d.reason), ...(err.errors || []).map((e) => e.reason)].join(' ');
  const email = sheetsServiceEmail();

  if (res.status === 429) {
    return new SheetsError('rate_limited', 'Google is rate-limiting requests right now. Wait a minute and try again.', 429);
  }
  if (res.status === 403 && (/SERVICE_DISABLED|accessNotConfigured/i.test(reasons) || /has not been used in project|API has not been enabled|is disabled/i.test(msg))) {
    return new SheetsError(
      'api_disabled',
      'The Google Sheets API is not enabled for the service account\'s Google Cloud project. Open APIs & Services → Library, enable "Google Sheets API", wait a minute, then try again.',
      502
    );
  }
  if (res.status === 403 && write) {
    return new SheetsError(
      'read_only',
      `This spreadsheet is shared as view-only. Share it with ${email} as an Editor to edit it from CTRLpanel.`,
      403
    );
  }
  if (res.status === 403 || res.status === 404) {
    return new SheetsError(
      'not_shared',
      `Google says this spreadsheet isn't accessible. Check the link, and share it with ${email} (Viewer to read, Editor to edit).`,
      403
    );
  }
  if (res.status === 400 && /Unable to parse range|Requested entity was not found/i.test(msg)) {
    return new SheetsError('tab_missing', 'That tab no longer exists in the spreadsheet. Pick another tab.', 400);
  }
  if (res.status === 400 && /not supported for this document/i.test(msg)) {
    return new SheetsError(
      'bad_request',
      'This file is an uploaded Excel/other file, not a native Google Sheet. In Google Sheets choose File → Save as Google Sheets, then link the new copy.',
      400
    );
  }
  if (res.status === 400) return new SheetsError('bad_request', `Google could not process that request: ${msg}`, 400);
  return new SheetsError('upstream', `Google Sheets error ${res.status}: ${msg}`, 502);
}

async function gapi(url, init = {}, { write = false } = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await classify(res, write);
  return res.status === 204 ? null : res.json();
}

/**
 * Is the connection actually usable? Signs in with the key, then probes the
 * Sheets API with a spreadsheet id that can't exist: 404 means "API enabled and
 * we are authenticated", while a disabled API answers SERVICE_DISABLED.
 */
export async function checkSheetsConnection() {
  const cfg = loadServiceAccount();
  if (!cfg) return { ok: false, code: 'not_configured', error: 'No service account is configured on the server yet.' };
  if (cfg.error) return { ok: false, code: 'not_configured', error: cfg.error, serviceEmail: '' };
  try {
    const token = await accessToken();
    const res = await fetch(`${sheetsApi()}/ctrlpanel-connection-check?fields=spreadsheetId`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, serviceEmail: cfg.email };
    const problem = await classify(res, false);
    // "Not found / not shared" for a made-up id is the expected healthy answer.
    if (problem.code === 'not_shared') return { ok: true, serviceEmail: cfg.email };
    return { ok: false, code: problem.code, error: problem.message, serviceEmail: cfg.email };
  } catch (e) {
    return { ok: false, code: e.code || 'upstream', error: e.message, serviceEmail: cfg.email };
  }
}

/* ---- Input validation ---- */
const ID_RE = /^[\w-]{8,200}$/;

function assertId(id) {
  if (!ID_RE.test(String(id || ''))) throw new SheetsError('bad_request', 'A valid spreadsheet id is required.', 400);
  return String(id);
}
function assertTitle(title) {
  const t = String(title ?? '');
  if (!t.trim() || t.length > 200) throw new SheetsError('bad_request', 'A sheet tab name is required.', 400);
  return t;
}
function cellValue(value) {
  if (value === null || value === undefined) return '';
  const v = typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  if (typeof v === 'string' && v.length > MAX_CELL_CHARS) {
    throw new SheetsError('bad_request', `A cell can hold at most ${MAX_CELL_CHARS} characters.`, 400);
  }
  return v;
}

/* ---- A1 helpers ---- */
export function colLetters(n) {
  let s = '';
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}
const quoteTitle = (t) => `'${String(t).replace(/'/g, "''")}'`;

/** Headers made unique and non-empty: blanks become "Column C", repeats become "Name (2)". */
export function uniqueHeaders(raw) {
  const seen = new Map();
  return raw.map((h, i) => {
    const base = String(h ?? '').trim() || `Column ${colLetters(i)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/* ---- Spreadsheet operations ---- */

/** Spreadsheet title + its tabs, so a board can offer multiple sheets. */
export async function getSpreadsheet(spreadsheetId) {
  const id = assertId(spreadsheetId);
  const data = await gapi(
    `${sheetsApi()}/${encodeURIComponent(id)}?fields=properties.title,spreadsheetUrl,sheets.properties(sheetId,title,index,gridProperties)`
  );
  return {
    id,
    title: data.properties?.title || 'Spreadsheet',
    url: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit`,
    sheets: (data.sheets || [])
      .map((s) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        index: s.properties.index,
        rows: s.properties.gridProperties?.rowCount || 0,
        cols: s.properties.gridProperties?.columnCount || 0,
      }))
      .sort((a, b) => a.index - b.index),
  };
}

/**
 * Read one tab. Row 1 is the header; every later row is `{ row, cells }` where
 * `row` is its 1-based sheet row (so edits hit the exact cell) and `cells`
 * aligns with `headers`. Values come as Sheets displays them (dates, currency,
 * percentages), blank rows are dropped, and `truncated` is set when the tab has
 * more than `maxRows` data rows.
 */
export async function readSheet(spreadsheetId, sheetTitle, { maxRows = MAX_ROWS } = {}) {
  const id = assertId(spreadsheetId);
  const title = assertTitle(sheetTitle);
  const range = `${quoteTitle(title)}!A1:${MAX_COLS_RANGE}${maxRows + 2}`; // header + maxRows + 1 sentinel row
  const data = await gapi(
    `${sheetsApi()}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`
  );
  const values = data.values || [];
  const body = values.slice(1);
  const truncated = body.length > maxRows;
  const kept = truncated ? body.slice(0, maxRows) : body;

  // Never hide data that sits right of the last header: widen to the widest row.
  const width = Math.max(values[0]?.length || 0, ...kept.map((cells) => cells.length));
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => values[0]?.[i]));
  const rows = [];
  kept.forEach((cells, i) => {
    const filled = Array.from({ length: width }, (_, c) => String(cells[c] ?? ''));
    if (filled.every((v) => v === '')) return; // fully blank rows are noise
    rows.push({ row: i + 2, cells: filled });
  });
  return { headers, rows, truncated, rowLimit: maxRows };
}

/** Write one cell (`rowNumber` is the 1-based sheet row from readSheet, `columnIndex` 0-based). */
export async function updateCell(spreadsheetId, sheetTitle, rowNumber, columnIndex, value) {
  const id = assertId(spreadsheetId);
  const title = assertTitle(sheetTitle);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new SheetsError('bad_request', 'Only data rows can be edited (row 1 is the header).', 400);
  }
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex > 701) {
    throw new SheetsError('bad_request', 'Invalid column.', 400);
  }
  const a1 = `${quoteTitle(title)}!${colLetters(columnIndex)}${rowNumber}`;
  await gapi(
    `${sheetsApi()}/${encodeURIComponent(id)}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ range: a1, majorDimension: 'ROWS', values: [[cellValue(value)]] }) },
    { write: true }
  );
  return { ok: true };
}

/** Append a row to the end of a tab. `values` aligns to the header order. */
export async function appendRow(spreadsheetId, sheetTitle, values) {
  const id = assertId(spreadsheetId);
  const title = assertTitle(sheetTitle);
  if (!Array.isArray(values) || !values.length || values.length > 702) {
    throw new SheetsError('bad_request', 'A row needs between 1 and 702 values.', 400);
  }
  const range = `${quoteTitle(title)}!A1`;
  const data = await gapi(
    `${sheetsApi()}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values.map(cellValue)] }) },
    { write: true }
  );
  const updatedRange = data?.updates?.updatedRange || null;
  const row = Number(updatedRange?.match(/!?[A-Z]+(\d+)/)?.[1]) || null;
  return { ok: true, updatedRange, row };
}

/** Delete sheet rows by their 1-based numbers (descending so indexes hold). The header row is never deleted. */
export async function deleteRows(spreadsheetId, sheetId, rowNumbers = []) {
  const id = assertId(spreadsheetId);
  if (!Number.isInteger(sheetId) || sheetId < 0) throw new SheetsError('bad_request', 'Invalid sheet.', 400);
  if (!Array.isArray(rowNumbers) || rowNumbers.length > 1000) {
    throw new SheetsError('bad_request', 'Delete at most 1000 rows at a time.', 400);
  }
  const sorted = [...new Set(rowNumbers.map(Number).filter((n) => Number.isInteger(n) && n > 1))].sort((a, b) => b - a);
  if (!sorted.length) return { ok: true, deleted: 0 };
  const requests = sorted.map((n) => ({
    deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
  }));
  await gapi(
    `${sheetsApi()}/${encodeURIComponent(id)}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) },
    { write: true }
  );
  return { ok: true, deleted: sorted.length };
}

/* ---- One dispatcher for both runtimes ---- */

/**
 * `/api/sheets/<action>` after authentication. Express (backend/routes/sheets.js)
 * and the Worker (worker/index.js) both call this, so the route surface cannot
 * drift between them. Returns `{ status, json }`, or null for an unknown action.
 */
export async function handleSheetsRequest(method, action, query = {}, body = {}) {
  try {
    if (method === 'GET') {
      if (action === 'meta') return { status: 200, json: await getSpreadsheet(query.id) };
      if (action === 'values') return { status: 200, json: await readSheet(query.id, query.sheet) };
      if (action === 'check') return { status: 200, json: await checkSheetsConnection() };
    }
    if (method === 'POST') {
      if (action === 'cell') {
        return { status: 200, json: await updateCell(body.id, body.sheet, Number(body.row), Number(body.col), body.value) };
      }
      if (action === 'append') return { status: 200, json: await appendRow(body.id, body.sheet, body.values) };
      if (action === 'delete-rows') return { status: 200, json: await deleteRows(body.id, Number(body.sheetId), body.rows || []) };
    }
    return null;
  } catch (e) {
    return { status: e instanceof SheetsError ? e.status : 502, json: { error: e?.message || 'Request failed', code: e?.code || 'upstream' } };
  }
}
