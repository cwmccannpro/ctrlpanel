import { useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import Badge from '../../components/shared/Badge.jsx';
import { useCrud } from '../../lib/useData.js';
import { INCOME_FREQUENCIES, INCOME_TYPES, EXPENSE_TYPES } from '../../lib/mockData.js';
import { currency, formatDate } from '../../lib/helpers.js';

function progressColor(pct) {
  if (pct > 0.9) return 'var(--red)';
  if (pct > 0.7) return 'var(--amber)';
  return 'var(--green)';
}

function sameMonth(dateStr, ref) {
  const d = new Date(dateStr);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

export default function Budget() {
  const income = useCrud('income_sources');
  const categories = useCrud('expense_categories');
  const txns = useCrud('transactions');
  const [monthOffset, setMonthOffset] = useState(0);
  const [addingTx, setAddingTx] = useState(null);

  const monthDate = new Date();
  monthDate.setMonth(monthDate.getMonth() + monthOffset);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const monthTxns = txns.rows.filter((t) => t.date && sameMonth(t.date, monthDate));
  const spentFor = (catId) => monthTxns.filter((t) => t.category_id === catId).reduce((s, t) => s + Number(t.amount || 0), 0);

  const totalIncome = income.rows.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalBudgeted = categories.rows.reduce((s, c) => s + Number(c.budgeted || 0), 0);
  const totalSpent = categories.rows.reduce((s, c) => s + spentFor(c.id), 0);
  const remaining = totalIncome - totalSpent;

  const catName = (id) => categories.rows.find((c) => c.id === id)?.name || '—';

  const saveTx = () => {
    if (!addingTx.amount) return;
    txns.add({
      amount: Number(addingTx.amount),
      category_id: addingTx.category_id || null,
      note: addingTx.note || null,
      date: addingTx.date,
      recurring: !!addingTx.recurring,
    });
    setAddingTx(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Budget</h1>
          <div className="page-header-sub">Income, categories & transactions</div>
        </div>
        <div className="row">
          <button className="btn btn--icon" onClick={() => setMonthOffset((m) => m - 1)}><i className="ti ti-chevron-left" /></button>
          <span style={{ minWidth: 130, textAlign: 'center', color: 'var(--text-primary)' }}>{monthLabel}</span>
          <button className="btn btn--icon" onClick={() => setMonthOffset((m) => m + 1)}><i className="ti ti-chevron-right" /></button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-4">
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Income</span><i className="ti ti-arrow-down-left" /></div><div className="stat-card-value text-green">{currency(totalIncome)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Budgeted</span><i className="ti ti-target" /></div><div className="stat-card-value">{currency(totalBudgeted)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Spent</span><i className="ti ti-arrow-up-right" /></div><div className="stat-card-value">{currency(totalSpent)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Remaining</span><i className="ti ti-wallet" /></div><div className={`stat-card-value ${remaining < 0 ? 'text-red' : 'text-green'}`}>{currency(remaining)}</div></Card>
      </div>

      <div className="grid grid-2">
        {/* Income — editable rows */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Income Sources</span>
            <button className="btn btn--sm btn--accent" onClick={() => income.add({ name: 'New source', amount: 0, frequency: 'Monthly', type: 'Business' })}>
              <i className="ti ti-plus" /> Add
            </button>
          </div>
          {income.rows.length === 0 && <p className="body-text">No income sources yet.</p>}
          {income.rows.map((i) => (
            <div className="edit-row" key={i.id}>
              <input className="input" value={i.name || ''} onChange={(e) => income.patch(i.id, { name: e.target.value })} placeholder="Name" style={{ flex: 2 }} />
              <input className="input" type="number" value={i.amount ?? ''} onChange={(e) => income.patch(i.id, { amount: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="Amount" style={{ width: 100 }} />
              <select className="select" value={i.frequency || 'Monthly'} onChange={(e) => income.patch(i.id, { frequency: e.target.value })} style={{ width: 110 }}>
                {INCOME_FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
              </select>
              <button className="btn btn--ghost btn--icon" onClick={() => income.remove(i.id)} title="Delete"><i className="ti ti-trash" /></button>
            </div>
          ))}
        </Card>

        {/* Transactions */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Transactions</span>
            <button className="btn btn--sm btn--accent" onClick={() => setAddingTx({ date: new Date().toISOString().slice(0, 10), category_id: categories.rows[0]?.id, recurring: false })}>
              <i className="ti ti-plus" /> Add
            </button>
          </div>
          {monthTxns.length === 0 && <p className="body-text">No transactions this month.</p>}
          {monthTxns.map((t) => (
            <div className="list-row" key={t.id}>
              <span className="list-row-time">{formatDate(t.date)}</span>
              <span className="list-row-title">{t.note || catName(t.category_id)}</span>
              {t.recurring && <Badge variant="accent">↻</Badge>}
              <span className="list-row-meta">{currency(t.amount)}</span>
              <button className="btn btn--ghost btn--icon" onClick={() => txns.remove(t.id)} title="Delete"><i className="ti ti-x" /></button>
            </div>
          ))}
        </Card>
      </div>

      {/* Expense categories — editable */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <span>Expense Categories</span>
          <button className="btn btn--sm btn--accent" onClick={() => categories.add({ name: 'New category', type: 'Variable', budgeted: 0 })}>
            <i className="ti ti-plus" /> Add
          </button>
        </div>
        {categories.rows.length === 0 && <p className="body-text">No categories yet. Add one to start budgeting.</p>}
        <div className="table-wrap" style={{ border: 'none' }}>
          {categories.rows.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'default' }}>Category</th>
                  <th style={{ cursor: 'default' }}>Type</th>
                  <th style={{ cursor: 'default' }}>Budgeted</th>
                  <th style={{ cursor: 'default' }}>Spent</th>
                  <th style={{ cursor: 'default' }}>Remaining</th>
                  <th style={{ cursor: 'default', width: 140 }}>Progress</th>
                  <th style={{ cursor: 'default', width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {categories.rows.map((c) => {
                  const spent = spentFor(c.id);
                  const budgeted = Number(c.budgeted || 0);
                  const pct = budgeted ? spent / budgeted : 0;
                  return (
                    <tr key={c.id}>
                      <td><input className="cell-input" value={c.name || ''} onChange={(e) => categories.patch(c.id, { name: e.target.value })} /></td>
                      <td>
                        <select className="cell-input" value={c.type || 'Variable'} onChange={(e) => categories.patch(c.id, { type: e.target.value })}>
                          {EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td><input className="cell-input" type="number" value={c.budgeted ?? ''} onChange={(e) => categories.patch(c.id, { budgeted: e.target.value === '' ? 0 : Number(e.target.value) })} style={{ width: 90 }} /></td>
                      <td>{currency(spent)}</td>
                      <td className={budgeted - spent < 0 ? 'text-red' : ''}>{currency(budgeted - spent)}</td>
                      <td><div className="progress"><div className="progress-fill" style={{ width: `${Math.min(pct * 100, 100)}%`, background: progressColor(pct) }} /></div></td>
                      <td><button className="btn btn--ghost btn--icon" onClick={() => categories.remove(c.id)} title="Delete"><i className="ti ti-trash" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {addingTx && (
        <Modal
          title="Add Transaction"
          onClose={() => setAddingTx(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddingTx(null)}>Cancel</button><button className="btn btn--accent" onClick={saveTx}>Save</button></>}
        >
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Amount ($)</label><input className="input" type="number" value={addingTx.amount || ''} onChange={(e) => setAddingTx({ ...addingTx, amount: e.target.value })} autoFocus /></div>
            <div className="field"><label className="field-label">Date</label><input className="input" type="date" value={addingTx.date} onChange={(e) => setAddingTx({ ...addingTx, date: e.target.value })} /></div>
          </div>
          <div className="field">
            <label className="field-label">Category</label>
            <select className="select" value={addingTx.category_id || ''} onChange={(e) => setAddingTx({ ...addingTx, category_id: e.target.value })}>
              <option value="">Uncategorized</option>
              {categories.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label className="field-label">Note</label><input className="input" value={addingTx.note || ''} onChange={(e) => setAddingTx({ ...addingTx, note: e.target.value })} /></div>
          <label className="checklist-item" style={{ border: 'none', cursor: 'pointer' }}>
            <input type="checkbox" className="cb" checked={!!addingTx.recurring} onChange={(e) => setAddingTx({ ...addingTx, recurring: e.target.checked })} />
            Recurring monthly
          </label>
        </Modal>
      )}
    </div>
  );
}
