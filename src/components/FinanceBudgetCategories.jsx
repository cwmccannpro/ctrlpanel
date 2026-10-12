import { financeMoney as currency } from '../lib/financeSheet.js';

export default function FinanceBudgetCategories({ summary, onEdit, onAdd, compact = false }) {
  const rows = [...summary.categories].sort((a, b) => b.budgeted - a.budgeted);
  return <section className="fin-section">
    <div className="fin-section-head"><div><h2>Spending plan</h2><p>Monthly budgets · actuals from your transaction log</p></div>{!compact && <button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Add category</button>}</div>
    {!rows.length && <p className="fin-empty">Add a category to start your monthly plan.</p>}
    {rows.slice(0, compact ? 5 : rows.length).map((c) => <button className="fin-budget-row" key={c.id} onClick={() => onEdit(c)} aria-label={`Edit ${c.name} budget`}>
      <div className="fin-budget-label"><strong>{c.name}</strong><span>{c.ratio > 1 ? 'Over budget' : c.type}</span></div>
      <div className="fin-budget-amount"><strong>{currency(c.spent)}</strong><span>of {currency(c.budgeted)}</span></div>
      <div className="fin-budget-track"><span style={{ width: `${Math.min(Math.max(c.ratio, 0), 1) * 100}%`, background: c.ratio > 1 ? 'var(--red)' : 'var(--accent)' }} /></div>
    </button>)}
    {summary.unassigned > 0 && <p className="fin-caption">{currency(summary.unassigned)} has no matching budget category.</p>}
  </section>;
}
