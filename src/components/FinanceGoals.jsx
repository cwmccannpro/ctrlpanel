import { financeMoney as currency } from '../lib/financeSheet.js';

export default function FinanceGoals({ rows = [], onEdit, onAdd }) {
  return <section className="fin-section">
    <div className="fin-section-head"><div><h3>Your goals</h3><p>Progress you choose to track</p></div><button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Add goal</button></div>
    {!rows.length && <p className="fin-empty">Add a financial goal to give your progress a destination.</p>}
    <div className="fin-goals">{rows.map((g) => <button className="fin-goal" key={g.id} onClick={() => onEdit(g)}><strong>{g.name}</strong><span>{g.current === null ? 'Current value unknown' : currency(g.current)} <small>/ {currency(g.target)}</small></span><div className="fin-budget-track"><span style={{ width: `${g.current !== null && g.target > 0 ? Math.min(100, g.current / g.target * 100) : 0}%` }} /></div></button>)}</div>
  </section>;
}
