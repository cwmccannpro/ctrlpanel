// Shared workbook contract and calculations. No browser or Node dependencies.
export const FINANCE_VERSION = '1';
export const financeMoney = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 });
const text = (key, label, options) => ({ key, label, type: options ? 'select' : 'text', options });
const money = (key, label, optional = false) => ({ key, label, type: 'number', optional, min: 0 });
export const FINANCE_TABLES = {
  accounts: { title: 'Accounts', label: 'Account', fields: [text('name', 'Account'), text('type', 'Type', ['Cash', 'Investment', 'Crypto', 'Property', 'Vehicle', 'Other', 'Receivable', 'Liability']), { ...money('balance', 'Balance', true), min: undefined }, text('notes', 'Notes')] },
  income: { title: 'Income', label: 'Income source', fields: [text('name', 'Source'), money('amount', 'Amount'), text('frequency', 'Frequency', ['Monthly', 'Weekly', 'Biweekly', 'Annual', 'One-off', 'Unspecified']), text('basis', 'Basis', ['Net', 'Gross', 'Extra']), { key: 'included', label: 'Include in plan', type: 'boolean' }, text('notes', 'Notes')] },
  budget: { title: 'Budget', label: 'Budget category', fields: [text('name', 'Category'), money('budgeted', 'Monthly budget'), text('type', 'Type', ['Fixed', 'Variable']), text('notes', 'Notes')] },
  transactions: { title: 'Transactions', label: 'Transaction', fields: [{ key: 'date', label: 'Date', type: 'date' }, text('name', 'Description'), money('amount', 'Amount'), text('type', 'Type', ['Expense', 'Income', 'Transfer']), { key: 'category_id', label: 'Category ID', type: 'category' }, { key: 'account_id', label: 'Account ID', type: 'account' }, text('notes', 'Notes')] },
  holdings: { title: 'Holdings', label: 'Holding', fields: [text('name', 'Holding'), text('ticker', 'Ticker'), { key: 'account_id', label: 'Account ID', type: 'account' }, money('shares', 'Shares'), money('avg_cost', 'Average cost'), money('price', 'Price'), text('notes', 'Notes')] },
  history: { title: 'History', label: 'Snapshot', fields: [{ key: 'date', label: 'Date', type: 'date' }, { ...money('net_worth', 'Net worth'), min: undefined }, money('cash', 'Cash'), money('investments', 'Investments'), money('debt', 'Debt')] },
  goals: { title: 'Goals', label: 'Goal', fields: [text('name', 'Goal'), money('target', 'Target'), money('current', 'Current', true), text('notes', 'Notes')] },
};
export const headersFor = (key) => ['ID', ...FINANCE_TABLES[key].fields.map((f) => f.label)];
export const monthlyAmount = (amount, frequency) => Number(amount || 0) * ({ Monthly: 1, Weekly: 52 / 12, Biweekly: 26 / 12, Annual: 1 / 12, 'One-off': 0 }[frequency] ?? 0);
export const financeDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
export function validateFinanceRecord(key, values) {
  const def = FINANCE_TABLES[key];
  if (!def) throw new Error('Unknown finance section.');
  const out = {};
  for (const f of def.fields) {
    let v = values[f.key];
    if (f.type === 'number') {
      if (v === '' || v === null || v === undefined) {
        if (!f.optional) throw new Error(`${f.label} is required.`);
        v = null;
      } else {
        v = Number(v);
        if (!Number.isFinite(v) || (f.min !== undefined && v < f.min)) throw new Error(`${f.label} must be a valid${f.min === 0 ? ' nonnegative' : ''} number.`);
      }
    } else if (f.type === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(`${f.label} must be a checkbox.`);
    } else {
      v = String(v ?? '').trim();
      if (v.length > 2000) throw new Error(`${f.label} is too long.`);
      if ((f.key === 'name' || f.type === 'date') && !v) throw new Error(`${f.label} is required.`);
      if (f.type === 'date' && !validDay(v)) throw new Error('Use a real date in YYYY-MM-DD format.');
      if (f.options && !f.options.includes(v)) throw new Error(`Choose a valid ${f.label.toLowerCase()}.`);
    }
    out[f.key] = v;
  }
  if (key === 'income' && out.basis === 'Gross' && out.included) throw new Error('Gross pay cannot be included in the take-home plan. Use a Net source.');
  if (key === 'income' && out.frequency === 'Unspecified' && out.included) throw new Error('Choose the income frequency before including it in your plan.');
  if (key === 'accounts' && out.type === 'Liability' && out.balance < 0) throw new Error('Enter the outstanding debt as a positive balance.');
  return out;
}

// Header names locate columns; IDs locate rows. Reordering either is safe.
export function parseFinanceGrid(key, sheet) {
  const def = FINANCE_TABLES[key];
  const raw = sheet.data?.[0]?.rowData || [];
  const headers = (raw[0]?.values || []).map((c) => String(c.effectiveValue?.stringValue ?? c.userEnteredValue?.stringValue ?? '').trim());
  const wanted = headersFor(key);
  for (const h of wanted) if (headers.filter((v) => v === h).length !== 1) throw new Error(`${def.title}: keep exactly one “${h}” header in row 1.`);
  const columns = Object.fromEntries([['id', headers.indexOf('ID')], ...def.fields.map((f) => [f.key, headers.indexOf(f.label)])]);
  const ids = new Set();
  const rows = raw.slice(1).flatMap((r, index) => {
    const cells = r.values || [];
    // Sheets creates FALSE cells when checkbox validation is applied to empty rows.
    // Those defaults alone are not records; checked boxes and all other data are.
    if (!Object.entries(columns).some(([field, col]) => {
      const value = cells[col]?.userEnteredValue || {};
      if (value.formulaValue) return true;
      if (def.fields.find((f) => f.key === field)?.type === 'boolean' && value.boolValue === false) return false;
      if (typeof value.stringValue === 'string' && !value.stringValue.trim()) return false;
      return Object.keys(value).length > 0;
    })) return [];
    if (cells[columns.id]?.userEnteredValue?.formulaValue) throw new Error(`${def.title} row ${index + 2}: IDs must be permanent values, not formulas.`);
    const id = String(cells[columns.id]?.effectiveValue?.stringValue ?? cells[columns.id]?.userEnteredValue?.stringValue ?? '').trim();
    if (!id || ids.has(id)) throw new Error(`${def.title} row ${index + 2}: each record needs a unique, permanent ID.`);
    ids.add(id);
    const values = {};
    const locked = [];
    for (const f of def.fields) {
      const c = cells[columns[f.key]] || {};
      if (c.effectiveValue?.errorValue) throw new Error(`${def.title} row ${index + 2}: ${f.label} has a formula error.`);
      const ev = c.effectiveValue || c.userEnteredValue || {};
      const val = ev.numberValue ?? ev.boolValue ?? ev.stringValue ?? null;
      values[f.key] = f.type === 'number' ? val : f.type === 'boolean' ? (val ?? false) : (val ?? '');
      if (c.userEnteredValue?.formulaValue) locked.push(f.key);
      if (f.type === 'number' && val !== null && typeof val !== 'number') throw new Error(`${def.title} row ${index + 2}: ${f.label} must be a number, not text.`);
    }
    const checked = validateFinanceRecord(key, values);
    const version = JSON.stringify(wanted.map((h) => cells[headers.indexOf(h)]?.userEnteredValue || null));
    return [{ id, ...checked, locked, version, _row: index + 2 }];
  });
  return { rows, columns, sheetId: sheet.properties.sheetId, width: headers.length };
}

const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
// Debt is retired from the app's presentation. Ignore older saved opt-ins.
export const financeDebtEnabled = () => false;

// Presentation preference only: preserve the original workbook and snapshot values.
export function financeViewData(data = {}, includeDebt = false) {
  if (includeDebt) return data;
  return { ...data,
    accounts: (data.accounts || []).filter((a) => a.type !== 'Liability'),
    history: (data.history || []).filter((r) => Number.isFinite(r.net_worth) && Number.isFinite(r.debt)).map((r) => ({ ...r, net_worth: r.net_worth + r.debt, debt: 0 })),
  };
}
export function financeSummary(data = {}, month = financeDay().slice(0, 7)) {
  const accounts = data.accounts || [];
  const income = data.income || [];
  const budget = data.budget || [];
  const transactions = (data.transactions || []).filter((t) => t.date?.slice(0, 7) === month);
  const cash = sum(accounts.filter((a) => a.type === 'Cash'), 'balance');
  const investments = sum(accounts.filter((a) => ['Investment', 'Crypto'].includes(a.type)), 'balance');
  const receivables = sum(accounts.filter((a) => a.type === 'Receivable'), 'balance');
  const other = sum(accounts.filter((a) => ['Property', 'Vehicle', 'Other'].includes(a.type)), 'balance');
  const debt = sum(accounts.filter((a) => a.type === 'Liability'), 'balance');
  const plannedIncome = income.filter((i) => i.included && i.basis !== 'Gross').reduce((s, i) => s + monthlyAmount(i.amount, i.frequency), 0);
  const plannedExpenses = sum(budget, 'budgeted');
  const expenses = transactions.filter((t) => t.type === 'Expense');
  const spent = sum(expenses, 'amount');
  const earned = sum(transactions.filter((t) => t.type === 'Income'), 'amount');
  const categories = budget.map((b) => {
    const actual = sum(expenses.filter((t) => t.category_id === b.id), 'amount');
    return { ...b, spent: actual, remaining: b.budgeted - actual, ratio: b.budgeted > 0 ? actual / b.budgeted : actual > 0 ? 1 : 0 };
  });
  return { cash, investments, receivables, other, debt, assets: cash + investments + receivables + other, netWorth: cash + investments + receivables + other - debt,
    plannedIncome, plannedExpenses, plannedSavings: plannedIncome - plannedExpenses,
    savingsRate: plannedIncome > 0 ? (plannedIncome - plannedExpenses) / plannedIncome : null,
    reserve: plannedExpenses > 0 ? cash / plannedExpenses : null, spent, earned, transactions, categories,
    unknownBalances: accounts.filter((a) => a.balance === null).length,
    unassigned: sum(expenses.filter((t) => !budget.some((b) => b.id === t.category_id)), 'amount'),
  };
}

// Read adapter for the Master Controller and weekly review. Old DB rows are
// retained, but connected finance views never merge them into the workbook.
export function financeAliases(data = {}) {
  return {
    accounts: data.accounts || [],
    income_sources: (data.income || []).map((r) => ({ ...r, type: r.basis })),
    expense_categories: data.budget || [],
    transactions: (data.transactions || []).map((r) => ({ ...r, note: r.name })),
    holdings: (data.holdings || []).map((r) => ({ ...r, manual_price: r.price })),
    net_worth_snapshots: (data.history || []).map((r) => ({ ...r, snapshot_date: r.date, total: r.net_worth })),
    portfolio_snapshots: (data.history || []).map((r) => ({ ...r, snapshot_date: r.date, total_value: r.investments })),
    dividends: [],
  };
}
