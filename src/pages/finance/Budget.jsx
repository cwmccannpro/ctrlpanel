import { useState } from 'react';
import Card from '../../components/shared/Card.jsx';
import Modal from '../../components/shared/Modal.jsx';
import Badge from '../../components/shared/Badge.jsx';
import { insert as sbInsert } from '../../lib/supabase.js';
import { mockIncome, mockExpenseCategories, mockTransactions } from '../../lib/mockData.js';
import { currency, formatDate } from '../../lib/helpers.js';

let tmpId = 0;

function progressColor(pct) {
  if (pct > 0.9) return 'var(--red)';
  if (pct > 0.7) return 'var(--amber)';
  return 'var(--green)';
}

export default function Budget() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [categories, setCategories] = useState(mockExpenseCategories);
  const [transactions, setTransactions] = useState(mockTransactions);
  const [adding, setAdding] = useState(null);

  const monthDate = new Date();
  monthDate.setMonth(monthDate.getMonth() + monthOffset);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const totalIncome = mockIncome.reduce((s, i) => s + i.amount, 0);
  const totalBudgeted = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const remaining = totalIncome - totalSpent;

  const catName = (id) => categories.find((c) => c.id === id)?.name || '—';

  const saveTx = () => {
    if (!adding.amount) return;
    const tx = { ...adding, id: `new-${Date.now()}-${tmpId++}`, amount: Number(adding.amount) };
    setTransactions((prev) => [tx, ...prev]);
    setCategories((prev) => prev.map((c) => (c.id === tx.category_id ? { ...c, spent: c.spent + tx.amount } : c)));
    sbInsert('transactions', [{ amount: tx.amount, category_id: tx.category_id, note: tx.note, date: tx.date, recurring: tx.recurring }]);
    setAdding(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Budget</h1>
          <div className="page-header-sub">Income, categories & transactions · demo data</div>
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
        {/* Income */}
        <Card className="card-section" static>
          <div className="card-section-title">Income Sources</div>
          {mockIncome.map((i) => (
            <div className="list-row" key={i.id}>
              <span className="list-row-title">{i.name}</span>
              <span className="badge">{i.frequency}</span>
              <span className="list-row-meta text-green">{currency(i.amount)}</span>
            </div>
          ))}
        </Card>

        {/* Transactions */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Transactions</span>
            <button className="btn btn--sm btn--accent" onClick={() => setAdding({ date: new Date().toISOString().slice(0, 10), category_id: categories[0]?.id, recurring: false })}>
              <i className="ti ti-plus" /> Add
            </button>
          </div>
          {transactions.map((t) => (
            <div className="list-row" key={t.id}>
              <span className="list-row-time">{formatDate(t.date)}</span>
              <span className="list-row-title">{t.note || catName(t.category_id)}</span>
              {t.recurring && <Badge variant="accent">↻</Badge>}
              <span className="list-row-meta">{currency(t.amount)}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Expense categories */}
      <Card className="card-section" static>
        <div className="card-section-title">Expense Categories</div>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ cursor: 'default' }}>Category</th>
                <th style={{ cursor: 'default' }}>Type</th>
                <th style={{ cursor: 'default' }}>Budgeted</th>
                <th style={{ cursor: 'default' }}>Spent</th>
                <th style={{ cursor: 'default' }}>Remaining</th>
                <th style={{ cursor: 'default', width: 160 }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const pct = c.budgeted ? c.spent / c.budgeted : 0;
                return (
                  <tr key={c.id}>
                    <td style={{ color: 'var(--text-primary)' }}>{c.name}</td>
                    <td>{c.type}</td>
                    <td>{currency(c.budgeted)}</td>
                    <td>{currency(c.spent)}</td>
                    <td className={c.budgeted - c.spent < 0 ? 'text-red' : ''}>{currency(c.budgeted - c.spent)}</td>
                    <td>
                      <div className="progress">
                        <div className="progress-fill" style={{ width: `${Math.min(pct * 100, 100)}%`, background: progressColor(pct) }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {adding && (
        <Modal
          title="Add Transaction"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveTx}>Save</button>
            </>
          }
        >
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Amount ($)</label>
              <input className="input" type="number" value={adding.amount || ''} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Date</label>
              <input className="input" type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Category</label>
            <select className="select" value={adding.category_id} onChange={(e) => setAdding({ ...adding, category_id: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Note</label>
            <input className="input" value={adding.note || ''} onChange={(e) => setAdding({ ...adding, note: e.target.value })} />
          </div>
          <label className="checklist-item" style={{ border: 'none', cursor: 'pointer' }}>
            <input type="checkbox" className="cb" checked={!!adding.recurring} onChange={(e) => setAdding({ ...adding, recurring: e.target.checked })} />
            Recurring monthly
          </label>
        </Modal>
      )}
    </div>
  );
}
