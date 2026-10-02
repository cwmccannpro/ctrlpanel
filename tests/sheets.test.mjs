import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  MAX_ROWS,
  SheetsError,
  appendRow,
  checkSheetsConnection,
  colLetters,
  deleteRows,
  getSheetsStatus,
  getSpreadsheet,
  handleSheetsRequest,
  loadServiceAccount,
  readSheet,
  resetSheetsCache,
  uniqueHeaders,
  updateCell,
} from '../backend/sheets.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const EMAIL = 'ctrlpanel@test-project.iam.gserviceaccount.com';
const ID = 'sheet-id-1234567890';

// A tiny fake Google: the token endpoint checks the JWT signature like Google
// would, and the Sheets endpoints record what they were asked.
let server;
let base;
let log;
let mode;

const reset = () => {
  log = [];
  mode = { values: [], tokenFail: false, apiDisabled: false, status: null, readOnly: false, meta: null };
};

before(async () => {
  reset();
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const googleError = (code, status, message, reason) =>
      send(code, { error: { code, status, message, details: reason ? [{ reason }] : [] } });

    if (url.pathname === '/token') {
      const assertion = new URLSearchParams(raw).get('assertion') || '';
      const [h, c, s] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
      log.push({ kind: 'token', header: JSON.parse(Buffer.from(h, 'base64url')), claim: JSON.parse(Buffer.from(c, 'base64url')), signatureValid: ok });
      if (mode.tokenFail || !ok) return send(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
      return send(200, { access_token: 'tok-1', expires_in: 3600 });
    }

    if (req.headers.authorization !== 'Bearer tok-1') return send(401, { error: { message: 'no auth' } });
    const path = decodeURIComponent(url.pathname.replace(/^\/sheets\/?/, ''));
    log.push({ kind: 'sheets', method: req.method, path, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : null });

    if (mode.status) return googleError(mode.status, 'X', mode.statusMessage || 'boom', mode.statusReason);
    if (path === 'ctrlpanel-connection-check') {
      if (mode.apiDisabled) return googleError(403, 'PERMISSION_DENIED', 'Google Sheets API has not been used in project 123 before or it is disabled.', 'SERVICE_DISABLED');
      return googleError(404, 'NOT_FOUND', 'Requested entity was not found.');
    }
    if (req.method === 'PUT' || path.endsWith(':append') || path.endsWith(':batchUpdate')) {
      if (mode.readOnly) return googleError(403, 'PERMISSION_DENIED', 'The caller does not have permission');
      if (path.endsWith(':append')) return send(200, { updates: { updatedRange: "'Contacts'!A12:C12" } });
      return send(200, {});
    }
    if (path === ID) return send(200, mode.meta || { properties: { title: 'Clients' }, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`, sheets: [
      { properties: { sheetId: 7, title: 'Notes', index: 1, gridProperties: { rowCount: 50, columnCount: 5 } } },
      { properties: { sheetId: 0, title: 'Contacts', index: 0, gridProperties: { rowCount: 100, columnCount: 6 } } },
    ] });
    if (path.startsWith(`${ID}/values/`)) return send(200, { values: mode.values });
    return googleError(404, 'NOT_FOUND', 'Requested entity was not found.');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

const ENV_KEYS = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_TOKEN_URL', 'GOOGLE_SHEETS_API_BASE'];
beforeEach(() => {
  reset();
  resetSheetsCache();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.GOOGLE_TOKEN_URL = `${base}/token`;
  process.env.GOOGLE_SHEETS_API_BASE = `${base}/sheets`;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = EMAIL;
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = privateKey;
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const sheetsCalls = () => log.filter((l) => l.kind === 'sheets');
const rejects = (promise, code) =>
  assert.rejects(promise, (e) => e instanceof SheetsError && e.code === code, `expected a ${code} SheetsError`);

/* ---------------- credentials ---------------- */

test('credentials: email + key pair, including a key with literal \\n escapes', () => {
  assert.deepEqual(loadServiceAccount(), { email: EMAIL, key: privateKey });
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = privateKey.replace(/\n/g, '\\n');
  assert.equal(loadServiceAccount().key, privateKey);
  assert.deepEqual(getSheetsStatus(), { ready: true, serviceEmail: EMAIL, configError: '' });
});

test('credentials: the whole JSON key file works raw and as base64', () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const file = JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: privateKey.replace(/\n/g, '\\n') });
  // dotenv leaves the file's own \n escapes in place; JSON.stringify of real newlines yields them too.
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: EMAIL, private_key: privateKey });
  assert.deepEqual(loadServiceAccount(), { email: EMAIL, key: privateKey });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(file).toString('base64');
  assert.deepEqual(loadServiceAccount(), { email: EMAIL, key: privateKey });
});

test('credentials: bad or missing config says what is wrong instead of crashing', () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{not json';
  assert.match(getSheetsStatus().configError, /not valid JSON/);
  assert.equal(getSheetsStatus().ready, false);
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"a@b.c"}';
  assert.match(getSheetsStatus().configError, /missing client_email or private_key/);
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  assert.equal(loadServiceAccount(), null);
  assert.deepEqual(getSheetsStatus(), { ready: false, serviceEmail: '', configError: '' });
});

/* ---------------- sign-in ---------------- */

test('sign-in sends a correctly signed RS256 JWT and caches the token', async () => {
  await getSpreadsheet(ID);
  await getSpreadsheet(ID);
  const tokenCalls = log.filter((l) => l.kind === 'token');
  assert.equal(tokenCalls.length, 1, 'the access token is reused');
  const [t] = tokenCalls;
  assert.equal(t.signatureValid, true);
  assert.deepEqual(t.header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(t.claim.iss, EMAIL);
  assert.equal(t.claim.scope, 'https://www.googleapis.com/auth/spreadsheets');
  assert.equal(t.claim.aud, `${base}/token`);
  assert.equal(t.claim.exp - t.claim.iat, 3600);
});

test('sign-in failures become readable errors', async () => {
  mode.tokenFail = true;
  await assert.rejects(getSpreadsheet(ID), (e) => e.code === 'auth' && /rejected the service account key/.test(e.message));
  resetSheetsCache();
  mode.tokenFail = false;
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'not a key';
  await rejects(getSpreadsheet(ID), 'auth');
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  await rejects(getSpreadsheet(ID), 'not_configured');
});

/* ---------------- reading ---------------- */

test('getSpreadsheet lists tabs in order', async () => {
  const meta = await getSpreadsheet(ID);
  assert.equal(meta.title, 'Clients');
  assert.deepEqual(meta.sheets.map((s) => s.title), ['Contacts', 'Notes']);
  assert.equal(meta.sheets[0].sheetId, 0);
});

test('readSheet returns formatted values, unique headers, real row numbers and no blank rows', async () => {
  mode.values = [
    ['Name', '', 'Name', 'Value'],
    ['Ada', 'x', 'Lovelace', '$1,200.50'],
    [],
    ['', '', '', ''],
    ['Bob', '', '', '12/31/2026', 'extra'],
  ];
  const out = await readSheet(ID, "Bob's Sheet");
  assert.deepEqual(out.headers, ['Name', 'Column B', 'Name (2)', 'Value', 'Column E']);
  assert.deepEqual(out.rows, [
    { row: 2, cells: ['Ada', 'x', 'Lovelace', '$1,200.50', ''] },
    { row: 5, cells: ['Bob', '', '', '12/31/2026', 'extra'] }, // header=1, Ada=2, two blank rows=3,4
  ]);
  assert.equal(out.truncated, false);
  const call = sheetsCalls().at(-1);
  assert.equal(call.query.valueRenderOption, 'FORMATTED_VALUE');
  assert.equal(call.path, `${ID}/values/'Bob''s Sheet'!A1:ZZ${MAX_ROWS + 2}`);
});

test('readSheet says when it truncated instead of dropping rows silently', async () => {
  mode.values = [['A'], ['1'], ['2'], ['3'], ['4']];
  const out = await readSheet(ID, 'Contacts', { maxRows: 3 });
  assert.equal(out.truncated, true);
  assert.equal(out.rows.length, 3);
  assert.equal(out.rowLimit, 3);
  assert.equal(sheetsCalls().at(-1).path.endsWith('!A1:ZZ5'), true);
});

test('an empty tab reads as no headers and no rows', async () => {
  mode.values = [];
  assert.deepEqual(await readSheet(ID, 'Contacts'), { headers: [], rows: [], truncated: false, rowLimit: MAX_ROWS });
});

test('uniqueHeaders and colLetters', () => {
  assert.deepEqual(uniqueHeaders(['A', 'A', ' ', undefined, 'A']), ['A', 'A (2)', 'Column C', 'Column D', 'A (3)']);
  assert.equal(colLetters(0), 'A');
  assert.equal(colLetters(25), 'Z');
  assert.equal(colLetters(26), 'AA');
  assert.equal(colLetters(701), 'ZZ');
});

/* ---------------- writing ---------------- */

test('updateCell writes one A1 cell with USER_ENTERED so dates and numbers parse', async () => {
  await updateCell(ID, 'Contacts', 5, 27, 'hello');
  const call = sheetsCalls().at(-1);
  assert.equal(call.method, 'PUT');
  assert.equal(call.path, `${ID}/values/'Contacts'!AB5`);
  assert.equal(call.query.valueInputOption, 'USER_ENTERED');
  assert.deepEqual(call.body.values, [['hello']]);
  await updateCell(ID, 'Contacts', 2, 0, null);
  assert.deepEqual(sheetsCalls().at(-1).body.values, [['']]);
});

test('updateCell refuses the header row and bad columns before calling Google', async () => {
  const before = sheetsCalls().length;
  await rejects(updateCell(ID, 'Contacts', 1, 0, 'x'), 'bad_request');
  await rejects(updateCell(ID, 'Contacts', 2.5, 0, 'x'), 'bad_request');
  await rejects(updateCell(ID, 'Contacts', 2, -1, 'x'), 'bad_request');
  await rejects(updateCell(ID, 'Contacts', 2, 0, 'x'.repeat(50001)), 'bad_request');
  await rejects(updateCell('bad id!', 'Contacts', 2, 0, 'x'), 'bad_request');
  assert.equal(sheetsCalls().length, before);
});

test('appendRow appends after the table and reports the new row number', async () => {
  const out = await appendRow(ID, 'Contacts', ['Ada', 42, true, null]);
  assert.equal(out.row, 12);
  const call = sheetsCalls().at(-1);
  assert.equal(call.path, `${ID}/values/'Contacts'!A1:append`);
  assert.equal(call.query.insertDataOption, 'INSERT_ROWS');
  assert.deepEqual(call.body.values, [['Ada', 42, true, '']]);
  await rejects(appendRow(ID, 'Contacts', []), 'bad_request');
});

test('deleteRows deletes bottom-up, dedupes, and never touches the header', async () => {
  const out = await deleteRows(ID, 7, [3, 9, 3, 1, 5, 'x', 0]);
  assert.equal(out.deleted, 3);
  const { requests } = sheetsCalls().at(-1).body;
  assert.deepEqual(requests.map((r) => r.deleteDimension.range.startIndex), [8, 4, 2]);
  assert.equal(requests[0].deleteDimension.range.sheetId, 7);
  assert.deepEqual(await deleteRows(ID, 7, [1]), { ok: true, deleted: 0 });
  await rejects(deleteRows(ID, -1, [2]), 'bad_request');
  await rejects(deleteRows(ID, 7, Array.from({ length: 1001 }, (_, i) => i + 2)), 'bad_request');
});

/* ---------------- Google errors → what the user should do ---------------- */

test('a disabled Sheets API is called out as such, not as a sharing problem', async () => {
  mode.status = 403;
  mode.statusMessage = 'Google Sheets API has not been used in project 123 before or it is disabled.';
  mode.statusReason = 'SERVICE_DISABLED';
  await assert.rejects(getSpreadsheet(ID), (e) => e.code === 'api_disabled' && /Enable|enable/.test(e.message));
});

test('403/404 on a read means "share it with the service account"', async () => {
  mode.status = 403;
  mode.statusMessage = 'The caller does not have permission';
  await assert.rejects(readSheet(ID, 'Contacts'), (e) => e.code === 'not_shared' && e.message.includes(EMAIL) && e.status === 403);
  mode.status = 404;
  await rejects(getSpreadsheet(ID), 'not_shared');
});

test('403 on a write means the sheet is view-only', async () => {
  mode.readOnly = true;
  await assert.rejects(updateCell(ID, 'Contacts', 2, 0, 'x'), (e) => e.code === 'read_only' && /Editor/.test(e.message) && e.message.includes(EMAIL));
  await rejects(appendRow(ID, 'Contacts', ['x']), 'read_only');
  await rejects(deleteRows(ID, 0, [2]), 'read_only');
});

test('other Google failures: deleted tab, Excel file, rate limit, server error', async () => {
  mode.status = 400;
  mode.statusMessage = "Unable to parse range: 'Gone'!A1:ZZ10002";
  await rejects(readSheet(ID, 'Gone'), 'tab_missing');
  mode.statusMessage = 'This operation is not supported for this document';
  await rejects(getSpreadsheet(ID), 'bad_request');
  mode.status = 429;
  await assert.rejects(getSpreadsheet(ID), (e) => e.code === 'rate_limited' && e.status === 429);
  mode.status = 503;
  mode.statusMessage = 'try later';
  await assert.rejects(getSpreadsheet(ID), (e) => e.code === 'upstream' && e.status === 502);
});

/* ---------------- connection check ---------------- */

test('checkSheetsConnection: healthy, API disabled, bad key, not configured', async () => {
  assert.deepEqual(await checkSheetsConnection(), { ok: true, serviceEmail: EMAIL });

  mode.apiDisabled = true;
  const disabled = await checkSheetsConnection();
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'api_disabled');
  mode.apiDisabled = false;

  resetSheetsCache();
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'garbage';
  assert.equal((await checkSheetsConnection()).code, 'auth');

  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  assert.equal((await checkSheetsConnection()).code, 'not_configured');
});

/* ---------------- shared dispatcher (Express + Worker) ---------------- */

test('handleSheetsRequest routes every action and maps errors to HTTP', async () => {
  mode.values = [['A'], ['1']];
  assert.equal((await handleSheetsRequest('GET', 'meta', { id: ID })).json.title, 'Clients');
  assert.equal((await handleSheetsRequest('GET', 'values', { id: ID, sheet: 'Contacts' })).json.rows.length, 1);
  assert.equal((await handleSheetsRequest('GET', 'check')).json.ok, true);
  assert.equal((await handleSheetsRequest('POST', 'cell', {}, { id: ID, sheet: 'Contacts', row: 2, col: 0, value: 'x' })).status, 200);
  assert.equal((await handleSheetsRequest('POST', 'append', {}, { id: ID, sheet: 'Contacts', values: ['x'] })).json.row, 12);
  assert.equal((await handleSheetsRequest('POST', 'delete-rows', {}, { id: ID, sheetId: 0, rows: [2] })).json.deleted, 1);

  assert.equal(await handleSheetsRequest('GET', 'nope'), null);
  assert.equal(await handleSheetsRequest('DELETE', 'meta'), null);

  const bad = await handleSheetsRequest('GET', 'meta', { id: 'x' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'bad_request');

  mode.readOnly = true;
  const ro = await handleSheetsRequest('POST', 'cell', {}, { id: ID, sheet: 'Contacts', row: 2, col: 0, value: 'x' });
  assert.equal(ro.status, 403);
  assert.equal(ro.json.code, 'read_only');

  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  resetSheetsCache();
  assert.equal((await handleSheetsRequest('GET', 'meta', { id: ID })).status, 503);
});
