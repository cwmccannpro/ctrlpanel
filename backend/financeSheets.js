import { randomUUID } from 'node:crypto';
import { financeGoogleRequest, getSpreadsheet, getSheetsStatus, SheetsError } from './sheets.js';
import { FINANCE_TABLES, FINANCE_VERSION, headersFor, parseFinanceGrid, validateFinanceRecord, financeSummary, financeDebtEnabled, financeViewData, validDay } from '../src/lib/financeSheet.js';

const quote = (s) => `'${s.replace(/'/g, "''")}'`;
const error = (code, message, status = 400) => { throw new SheetsError(code, message, status); };
const MAX_ROWS = 5000;
const userValue = (v) => v === null || v === '' ? {} : typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) };
const LETTERS = (i) => { let out = ''; do { out = String.fromCharCode(65 + i % 26) + out; i = Math.floor(i / 26) - 1; } while (i >= 0); return out; };

// Requests carry the user's own access token, never a service-role DB key.
async function userDb(token, path, init = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) error('settings', 'Could not save or read your finance connection.', 502);
  return res.status === 204 ? null : res.json();
}
async function preferences(token, user) {
  const rows = await userDb(token, `user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=ui_preferences`);
  return rows[0]?.ui_preferences?.finance || {};
}
async function saveConnection(token, patch) {
  return userDb(token, 'rpc/merge_ui_preferences', { method: 'POST', body: JSON.stringify({ section_key: 'finance', patch }) });
}

export async function assertFinanceOwner(id, email) {
  const range = `${quote('_CTRLpanel')}!A1:B10`;
  let data;
  try { data = await financeGoogleRequest(id, `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`); }
  catch (e) { if (e.code === 'tab_missing') error('contract', 'This workbook needs the CTRLpanel finance template and its _CTRLpanel ownership tab.'); throw e; }
  const config = Object.fromEntries((data.values || []).map((r) => [String(r[0]), String(r[1] ?? '')]));
  if (!email || config.owner_email?.trim().toLowerCase() !== email.trim().toLowerCase()) error('owner', 'This finance workbook belongs to a different account. Its _CTRLpanel owner_email must match your CTRLpanel sign-in email.', 403);
  if (config.version !== FINANCE_VERSION || config.currency !== 'USD') error('contract', 'Use finance template version 1 with USD currency.');
}

export async function readFinanceWorkbook(id, email, keys = Object.keys(FINANCE_TABLES)) {
  await assertFinanceOwner(id, email);
  const meta = await getSpreadsheet(id);
  for (const key of keys) if (!FINANCE_TABLES[key] || !meta.sheets.some((s) => s.title === FINANCE_TABLES[key].title)) error('contract', `The workbook is missing its ${FINANCE_TABLES[key]?.title || key} tab.`);
  const ranges = keys.map((key) => {
    const tab = meta.sheets.find((s) => s.title === FINANCE_TABLES[key].title);
    if (tab.cols > 100) error('contract', `${tab.title}: keep the finance data within 100 columns.`);
    return `ranges=${encodeURIComponent(`${quote(tab.title)}!A1:${LETTERS(tab.cols - 1)}${Math.min(tab.rows, MAX_ROWS + 2)}`)}`;
  }).join('&');
  const grid = await financeGoogleRequest(id, `?${ranges}&includeGridData=true&fields=sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,effectiveValue))))`);
  const tables = {};
  for (const key of keys) {
    const sheet = grid.sheets?.find((s) => s.properties.title === FINANCE_TABLES[key].title);
    if (!sheet) error('contract', `Unable to read ${FINANCE_TABLES[key].title}.`);
    if ((sheet.data?.[0]?.rowData?.length || 0) > MAX_ROWS + 1) error('limit', `${FINANCE_TABLES[key].title} exceeds ${MAX_ROWS} records. Archive older records before continuing.`);
    try { tables[key] = parseFinanceGrid(key, sheet); } catch (e) { error('contract', e.message); }
  }
  return { meta, tables };
}

export async function writeFinanceRecord(id, email, { table, recordId, values, version, remove = false }) {
  if (!FINANCE_TABLES[table] || table === 'history') error('bad_request', 'Choose an editable finance section.');
  const { tables } = await readFinanceWorkbook(id, email, [table]);
  const current = tables[table];
  const row = recordId ? current.rows.find((r) => r.id === recordId) : null;
  if (recordId && !row) error('conflict', 'This record was removed in Google Sheets. Refresh before editing.', 409);
  if (row && (!version || row.version !== version)) error('conflict', 'This record changed in Google Sheets. Refresh and review the latest values before saving.', 409);
  if (remove && !row) error('bad_request', 'Choose a record to remove.');
  if (remove && row.locked.length) error('formula', 'This record contains formulas. Remove it directly in Google Sheets.');
  const checked = remove ? null : validateFinanceRecord(table, values || {});
  if (!row) {
    const record = { id: randomUUID(), ...checked };
    // RAW prevents descriptions beginning with =, +, -, or @ becoming formulas.
    const headers = Object.entries(current.columns).sort((a, b) => a[1] - b[1]);
    const cells = Array.from({ length: current.width }, () => '');
    for (const [key, column] of headers) cells[column] = record[key] ?? '';
    const range = `${quote(FINANCE_TABLES[table].title)}!A1`;
    await financeGoogleRequest(id, `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [cells] }) });
    return { ok: true, id: record.id };
  }
  const requests = [];
  for (const [key, column] of Object.entries(current.columns)) {
    if (!remove && key === 'id') continue;
    const changed = remove || checked[key] !== row[key];
    if (!changed) continue;
    if (row.locked.includes(key)) error('formula', `${FINANCE_TABLES[table].title}: ${key} is calculated in Sheets and cannot be overwritten.`);
    requests.push({ updateCells: { start: { sheetId: current.sheetId, rowIndex: row._row - 1, columnIndex: column }, rows: [{ values: [{ userEnteredValue: remove ? {} : userValue(checked[key]) }] }], fields: 'userEnteredValue' } });
  }
  if (requests.length) await financeGoogleRequest(id, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  // Clearing a record preserves all other rows, formulas, and cell references.
  return { ok: true, id: row.id };
}

export async function handleFinanceSheetsRequest(method, action, { token, user, body = {} }) {
  try {
    if (!user?.id || !token) error('auth', 'Sign in to view your finances.', 401);
    if (method === 'GET' && action === 'status') return { status: 200, json: { ...getSheetsStatus(), connection: await preferences(token, user) } };
    if (method === 'POST' && action === 'connect') {
      const id = String(body.spreadsheetId || '');
      const { meta } = await readFinanceWorkbook(id, user.email);
      const connection = { spreadsheetId: id, title: meta.title, url: meta.url, version: FINANCE_VERSION };
      await saveConnection(token, connection);
      return { status: 200, json: { connection } };
    }
    if (method === 'POST' && action === 'disconnect') {
      await saveConnection(token, { spreadsheetId: null, title: null, url: null });
      return { status: 200, json: { ok: true } };
    }
    const connection = await preferences(token, user);
    if (method === 'GET' && action === 'workbook' && !connection.spreadsheetId) return { status: 200, json: { connected: false } };
    if (!connection.spreadsheetId) error('not_connected', 'Connect your finance workbook first.');
    const id = connection.spreadsheetId; // Never take a write target from request payloads.
    if (method === 'GET' && action === 'workbook') {
      const { meta, tables } = await readFinanceWorkbook(id, user.email);
      const data = Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, t.rows.map(({ _row, ...row }) => row)]));
      const includeDebt = financeDebtEnabled();
      return { status: 200, json: { connected: true, includeDebt, connection: { ...connection, title: meta.title }, data: financeViewData(data, includeDebt), refreshedAt: Date.now() } };
    }
    if (method === 'POST' && action === 'record') return { status: 200, json: await writeFinanceRecord(id, user.email, body) };
    if (method === 'POST' && action === 'snapshot') {
      if (!validDay(body.date)) error('bad_request', 'A local calendar date is required.');
      const { tables } = await readFinanceWorkbook(id, user.email);
      const data = Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, t.rows]));
      const s = financeSummary(data);
      if (s.unknownBalances) error('incomplete', 'Fill in unknown account balances before recording a snapshot.');
      const snapshot = { id: randomUUID(), date: body.date, net_worth: s.netWorth, cash: s.cash, investments: s.investments, debt: s.debt };
      const row = Array.from({ length: tables.history.width }, () => '');
      for (const [field, column] of Object.entries(tables.history.columns)) row[column] = snapshot[field];
      await financeGoogleRequest(id, `/values/${encodeURIComponent("'History'!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [row] }) });
      return { status: 200, json: { ok: true } };
    }
    return null;
  } catch (e) { return { status: e.status || 400, json: { error: e.message || 'Finance request failed.', code: e.code || 'bad_request' } }; }
}
