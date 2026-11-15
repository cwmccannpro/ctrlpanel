import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import { FINANCE_TABLES, headersFor, parseFinanceGrid, financeSummary, financeViewData, financeDebtEnabled, validateFinanceRecord, financeAliases, monthlyAmount, validDay } from '../src/lib/financeSheet.js';
import { readFinanceWorkbook, writeFinanceRecord, handleFinanceSheetsRequest } from '../backend/financeSheets.js';
import { resetSheetsCache, handleSheetsRequest } from '../backend/sheets.js';

const cell = (v) => v === null ? {} : { userEnteredValue: typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v }, effectiveValue: typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: v } };
const grid = (key, rows = [], headers = headersFor(key)) => ({ properties: { title: FINANCE_TABLES[key].title, sheetId: Object.keys(FINANCE_TABLES).indexOf(key) + 1 }, data: [{ rowData: [headers, ...rows].map((r) => ({ values: r.map(cell) })) }] });
const account = ['a1', 'Checking', 'Cash', 1000, ''];
test('header and row moves preserve identities and typed numbers, including unknown balances', () => {
  const headers = ['Notes', 'Balance', 'ID', 'Type', 'Account'];
  const t = parseFinanceGrid('accounts', grid('accounts', [['', null, 'a2', 'Investment', 'Brokerage'], ['', 1000, 'a1', 'Cash', 'Checking']], headers));
  assert.equal(t.rows[0].balance, null);
  assert.equal(t.rows[1].id, 'a1');
  assert.equal(t.columns.balance, 1);
  assert.equal(t.rows[1]._row, 3);
});
test('rejects duplicate IDs, missing headers, text money and formula errors', () => {
  assert.throws(() => parseFinanceGrid('accounts', grid('accounts', [account, account])), /unique/);
  assert.throws(() => parseFinanceGrid('accounts', grid('accounts', [], ['ID', 'Account'])), /Type/);
  assert.throws(() => parseFinanceGrid('accounts', grid('accounts', [['a1', 'Checking', 'Cash', '$1,000', '']])), /number, not text/);
  const sheet = grid('accounts', [account]);
  sheet.data[0].rowData[1].values[3].effectiveValue = { errorValue: { type: 'REF' } };
  assert.throws(() => parseFinanceGrid('accounts', sheet), /formula error/);
});

test('unused checkbox rows are empty, but incomplete or checked income rows fail validation', () => {
  const source = ['income1', 'Salary', 3500, 'Monthly', 'Net', true, ''];
  const empty = [null, null, null, null, null, false, null];
  const parsed = parseFinanceGrid('income', grid('income', [empty, source, empty]));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]._row, 3);
  assert.throws(() => parseFinanceGrid('income', grid('income', [[null, null, null, null, null, true, null]])), /permanent ID/);
  assert.throws(() => parseFinanceGrid('income', grid('income', [[null, 'Incomplete salary', null, null, null, false, null]])), /permanent ID/);
});
test('calculations separate receivables, positions, gross pay, expenses and transfers', () => {
  const s = financeSummary({ accounts: [
    { name: 'Checking', type: 'Cash', balance: 1000 }, { type: 'Receivable', balance: 500 }, { type: 'Other', balance: 200 }, { type: 'Investment', balance: 800 }, { type: 'Investment', balance: null }, { type: 'Liability', balance: 700 },
  ], income: [{ amount: 3000, frequency: 'Monthly', basis: 'Net', included: true }, { amount: 4000, frequency: 'Monthly', basis: 'Gross', included: true }, { amount: 1200, frequency: 'Annual', basis: 'Extra', included: true }, { amount: 50, frequency: 'One-off', basis: 'Extra', included: true }],
  budget: [{ id: 'b1', budgeted: 500 }], holdings: [{ shares: 10, price: 100 }], transactions: [
    { date: '2026-10-01', type: 'Expense', amount: 200, category_id: 'b1' }, { date: '2026-10-01', type: 'Transfer', amount: 1000 }, { date: '2026-10-01', type: 'Income', amount: 2500 }, { date: '2026-09-30', type: 'Expense', amount: 100 }, { date: '2026-10-02', type: 'Expense', amount: 20 },
  ] }, '2026-10');
  assert.equal(s.cash, 1000); assert.equal(s.assets, 2500); assert.equal(s.netWorth, 1800); assert.equal(s.debt, 700);
  assert.equal(s.plannedIncome, 3100); assert.equal(s.plannedSavings, 2600); assert.equal(s.reserve, 2);
  assert.equal(s.spent, 220); assert.equal(s.earned, 2500); assert.equal(s.categories[0].spent, 200); assert.equal(s.unassigned, 20); assert.equal(s.unknownBalances, 1);
  assert.equal(financeSummary({}).reserve, null);
  assert.equal(monthlyAmount(120, 'Unspecified'), 0);
});
test('validation rejects invalid dates, Infinity, gross-plan double counting and unknown cadence', () => {
  assert.equal(validDay('2026-02-29'), false); assert.equal(validDay('2028-02-29'), true);
  assert.throws(() => validateFinanceRecord('accounts', { name: 'A', type: 'Cash', balance: Infinity }), /valid/);
  assert.throws(() => validateFinanceRecord('income', { name: 'Gross', amount: 10, frequency: 'Monthly', basis: 'Gross', included: true }), /Gross/);
  assert.throws(() => validateFinanceRecord('income', { name: 'Extra', amount: 10, frequency: 'Unspecified', basis: 'Extra', included: true }), /frequency/);
  assert.equal(validateFinanceRecord('accounts', { name: 'Overdrawn', type: 'Cash', balance: -20 }).balance, -20);
  assert.equal(financeAliases({ transactions: [{ name: 'Purchase' }] }).transactions[0].note, 'Purchase');
});

const originalFetch = globalThis.fetch;
const keys = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_TOKEN_URL', 'GOOGLE_SHEETS_API_BASE', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const originalEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
const owner = { id: 'user1', email: 'owner@example.com' };
let calls, workbook, financePreferences;
beforeEach(() => {
  financePreferences = { spreadsheetId: 'sheet12345' };
  calls = []; workbook = Object.fromEntries(Object.keys(FINANCE_TABLES).map((key) => [key, grid(key, key === 'accounts' ? [account] : [])]));
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'service@example.com'; process.env.GOOGLE_SERVICE_ACCOUNT_KEY = privateKey;
  process.env.GOOGLE_TOKEN_URL = 'https://fake/token'; process.env.GOOGLE_SHEETS_API_BASE = 'https://fake/sheets'; process.env.SUPABASE_URL = 'https://db'; process.env.SUPABASE_ANON_KEY = 'anon';
  resetSheetsCache();
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); const raw = String(init.body || ''); const body = raw.startsWith('{') ? JSON.parse(raw) : null;
    calls.push({ url: String(url), method: init.method || 'GET', body, headers: init.headers });
    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/token') return json({ access_token: 'fake-token', expires_in: 3600 });
    if (u.hostname === 'db') return json(u.pathname.includes('rpc') ? {} : [{ ui_preferences: { finance: financePreferences } }]);
    if (u.pathname.includes('/values/')) {
      if (init.method === 'POST') return json({ updates: { updatedRange: "'Accounts'!A3:E3" } });
      return json({ values: [['Key', 'Value'], ['owner_email', owner.email], ['version', '1'], ['currency', 'USD']] });
    }
    if (init.method === 'POST') return json({});
    if (u.searchParams.has('includeGridData')) return json({ sheets: Object.values(workbook).filter((s) => u.searchParams.getAll('ranges').some((r) => r.startsWith(`'${s.properties.title}'!`))) });
    return json({ properties: { title: 'Finance' }, sheets: [...Object.values(workbook).map((s) => ({ properties: { ...s.properties, gridProperties: { rowCount: 1000, columnCount: headersFor(Object.keys(workbook).find((k) => workbook[k] === s)).length } } })), { properties: { sheetId: 99, title: '_CTRLpanel', gridProperties: { rowCount: 100, columnCount: 2 } } }] });
  };
});
after(() => { globalThis.fetch = originalFetch; for (const k of keys) originalEnv[k] === undefined ? delete process.env[k] : process.env[k] = originalEnv[k]; });
test('owner mismatch stops before reading financial rows', async () => {
  await assert.rejects(readFinanceWorkbook('sheet12345', 'other@example.com'), (e) => e.code === 'owner' && e.status === 403);
  assert.equal(calls.some((c) => c.url.includes('includeGridData')), false);
});

test('asset views exclude liabilities and reconstruct asset history without changing source records', () => {
  const original = { accounts: [{ type: 'Cash', balance: 6700 }, { type: 'Investment', balance: 1211 }, { type: 'Receivable', balance: 800 }, { type: 'Other', balance: 600 }, { type: 'Liability', balance: 25550 }, { type: 'Liability', balance: null }], history: [{ date: '2026-10-01', net_worth: -16239, debt: 25550 }, { date: '2026-10-02', net_worth: null, debt: null }] };
  const copy = structuredClone(original);
  const view = financeViewData(original, false);
  const summary = financeSummary(view);
  assert.equal(summary.assets, 9311);
  assert.equal(summary.netWorth, 9311);
  assert.equal(summary.debt, 0);
  assert.equal(summary.unknownBalances, 0);
  assert.equal(view.accounts.some((r) => r.type === 'Liability'), false);
  assert.equal(view.history[0].net_worth, 9311);
  assert.equal(view.history.length, 1);
  assert.deepEqual(financeViewData(view, false), view);
  assert.deepEqual(original, copy);
  assert.equal(financeViewData(original, true), original);
  assert.equal(financeDebtEnabled({ ui_preferences: { finance: { includeDebt: false } } }), false);
  assert.deepEqual(financeViewData(original), view);
  assert.equal(financeDebtEnabled({}), false);
  assert.equal(financeDebtEnabled({ ui_preferences: { finance: { includeDebt: true } } }), false);
});

test('workbook reads always exclude debt, including old opt-ins, while retaining all underlying sheet records', async () => {
  workbook.accounts = grid('accounts', [account, ['d1', 'Loan', 'Liability', 700, '']]);
  workbook.history = grid('history', [['h1', '2026-10-01', 300, 1000, 0, 700]]);
  const read = await handleFinanceSheetsRequest('GET', 'workbook', { token: 'owner-token', user: owner });
  assert.equal(read.json.includeDebt, false);
  assert.equal(read.json.data.accounts.length, 1);
  assert.equal(read.json.data.history[0].net_worth, 1000);
  assert.equal(financeAliases(read.json.data).net_worth_snapshots[0].total, 1000);
  assert.equal(calls.some((c) => c.method !== 'GET' && !c.url.endsWith('/token')), false);
  financePreferences.includeDebt = true;
  const legacy = await handleFinanceSheetsRequest('GET', 'workbook', { token: 'owner-token', user: owner });
  assert.equal(legacy.json.includeDebt, false);
  assert.equal(legacy.json.data.accounts.length, 1);
  assert.equal(legacy.json.data.history[0].net_worth, 1000);
  const source = await readFinanceWorkbook('sheet12345', owner.email);
  assert.equal(source.tables.accounts.rows.length, 2);
  assert.equal(source.tables.history.rows[0].net_worth, 300);
});
test('stable ID editing locates a moved row and does not change neighboring cells', async () => {
  const original = parseFinanceGrid('accounts', workbook.accounts).rows[0];
  workbook.accounts = grid('accounts', [['a2', 'Savings', 'Cash', 50, ''], account]);
  await writeFinanceRecord('sheet12345', owner.email, { table: 'accounts', recordId: 'a1', version: original.version, values: { ...original, balance: 1200 } });
  const write = calls.find((c) => c.url.endsWith(':batchUpdate'));
  assert.equal(write.body.requests.length, 1);
  assert.deepEqual(write.body.requests[0].updateCells.start, { sheetId: 1, rowIndex: 2, columnIndex: 3 });
  assert.deepEqual(write.body.requests[0].updateCells.rows[0].values[0].userEnteredValue, { numberValue: 1200 });
});
test('changed values reject stale saves and stale deletions', async () => {
  const original = parseFinanceGrid('accounts', workbook.accounts).rows[0];
  workbook.accounts = grid('accounts', [['a1', 'Checking', 'Cash', 1500, '']]);
  for (const remove of [false, true]) await assert.rejects(writeFinanceRecord('sheet12345', owner.email, { table: 'accounts', recordId: 'a1', version: original.version, values: original, remove }), (e) => e.code === 'conflict');
  assert.equal(calls.some((c) => c.method === 'POST' && c.url.includes('sheets/')), false);
});
test('formulas are locked and new text is written RAW to prevent injection', async () => {
  const c = workbook.accounts.data[0].rowData[1].values[3]; c.userEnteredValue = { formulaValue: '=SUM(A1)' };
  const original = parseFinanceGrid('accounts', workbook.accounts).rows[0];
  assert.deepEqual(original.locked, ['balance']);
  await assert.rejects(writeFinanceRecord('sheet12345', owner.email, { table: 'accounts', recordId: 'a1', version: original.version, values: { ...original, balance: 2 } }), (e) => e.code === 'formula');
  await writeFinanceRecord('sheet12345', owner.email, { table: 'accounts', values: { name: '=IMPORTXML("evil")', type: 'Cash', balance: null, notes: '' } });
  const write = calls.find((c) => c.url.includes(':append'));
  assert.ok(write.url.includes('valueInputOption=RAW'));
  assert.equal(write.body.values[0][1], '=IMPORTXML("evil")');
});
test('removal clears only contract cells, preserving row references', async () => {
  const row = parseFinanceGrid('accounts', workbook.accounts).rows[0];
  await writeFinanceRecord('sheet12345', owner.email, { table: 'accounts', recordId: 'a1', version: row.version, remove: true });
  const write = calls.find((c) => c.url.endsWith(':batchUpdate'));
  assert.equal(write.body.requests.length, 5);
  assert.equal(write.body.requests.some((r) => r.deleteDimension), false);
});
test('finance dispatcher requires a session, uses only saved sheet, and writes preferences with RLS token', async () => {
  assert.equal((await handleFinanceSheetsRequest('GET', 'workbook', { user: null })).status, 401);
  const result = await handleFinanceSheetsRequest('POST', 'connect', { token: 'session-token', user: owner, body: { spreadsheetId: 'sheet12345', user_id: 'another-user' } });
  assert.equal(result.status, 200);
  const saved = calls.find((c) => c.url.includes('/rpc/'));
  assert.equal(saved.headers.Authorization, 'Bearer session-token'); assert.equal(saved.headers.apikey, 'anon');
  assert.equal(saved.body.patch.user_id, undefined);
  calls = [];
  const row = parseFinanceGrid('accounts', workbook.accounts).rows[0];
  const write = await handleFinanceSheetsRequest('POST', 'record', { token: 'session-token', user: owner, body: { spreadsheetId: 'other-sheet', table: 'accounts', recordId: row.id, version: row.version, values: { ...row, balance: 7 } } });
  assert.equal(write.status, 200); assert.equal(calls.some((c) => c.url.includes('other-sheet')), false);
});
test('generic CRM endpoints cannot bypass finance ownership or safe writes', async () => {
  const denied = await handleSheetsRequest('GET', 'meta', { id: 'sheet12345' }, {}, { user: { email: 'other@example.com' } });
  assert.equal(denied.status, 403); assert.equal(denied.json.code, 'owner');
  const write = await handleSheetsRequest('POST', 'cell', {}, { id: 'sheet12345', sheet: 'Accounts', row: 2, col: 3, value: 0 }, { user: owner });
  assert.equal(write.status, 403); assert.equal(write.json.code, 'finance_managed');
});

test('snapshots follow reordered History headers and retain literal dates', async () => {
  workbook.history = grid('history', [], ['Debt', 'Date', 'ID', 'Investments', 'Cash', 'Net worth']);
  const result = await handleFinanceSheetsRequest('POST', 'snapshot', { token: 'session-token', user: owner, body: { date: '2026-10-06' } });
  assert.equal(result.status, 200);
  const row = calls.find((c) => c.url.includes(':append')).body.values[0];
  assert.equal(row[0], 0);
  assert.equal(row[1], '2026-10-06');
  assert.match(row[2], /^[\w-]+$/);
  assert.deepEqual(row.slice(3), [0, 1000, 1000]);
});
