import { financeMoney as currency, monthlyAmount } from '../lib/financeSheet.js';

export default function FinanceIncome({ rows = [], onEdit, onAdd }) {
  return <section className="fin-section">
    <div className="fin-section-head"><div><h3>Income sources</h3><p>Gross references stay separate from take-home pay</p></div><button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Add source</button></div>
    {!rows.length && <p className="fin-empty">Add your take-home income to build a plan.</p>}
    {rows.map((r) => <button key={r.id} className="fin-income" onClick={() => onEdit(r)}><span><strong>{r.name}</strong><small>{r.basis} · {r.frequency} · {r.included ? 'In plan' : 'Excluded from plan'}</small></span><span><strong>{currency(r.amount)}</strong>{r.included && <small>{currency(monthlyAmount(r.amount, r.frequency))} / mo</small>}</span></button>)}
  </section>;
}
