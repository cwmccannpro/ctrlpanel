import { financeMoney as currency } from '../lib/financeSheet.js';

export default function FinanceHoldings({ rows = [], accounts = [], onEdit, onAdd }) {
  const value = rows.reduce((s, r) => s + r.shares * r.price, 0);
  const cost = rows.reduce((s, r) => s + r.shares * r.avg_cost, 0);
  return <section className="fin-section">
    <div className="fin-section-head"><div><h3>Positions</h3><p>Recorded prices · positions within your account totals</p></div><button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Add holding</button></div>
    {!!rows.length && <div className="fin-position-summary"><span>Position value <strong>{currency(value)}</strong></span><span>Unrealized change <strong className={value - cost >= 0 ? 'text-green' : 'text-red'}>{currency(value - cost)}</strong></span></div>}
    {!rows.length && <div className="fin-empty"><i className="ti ti-chart-candle" aria-hidden="true" /><strong>See what’s inside your portfolio</strong><p>Add positions with shares, cost and a recorded price. Your investment account balances already feed total assets.</p></div>}
    {rows.map((r) => <button className="fin-holding" key={r.id} onClick={() => onEdit(r)}><span className="fin-ticker">{r.ticker || '—'}</span><span className="fin-transaction-name"><strong>{r.name}</strong><span>{r.shares.toLocaleString()} shares · {accounts.find((a) => a.id === r.account_id)?.name || 'Unassigned account'} · {currency(r.price)} / share</span></span><span className="fin-holding-value"><strong>{currency(r.shares * r.price)}</strong><span className={r.price >= r.avg_cost ? 'text-green' : 'text-red'}>{currency(r.shares * (r.price - r.avg_cost))}</span></span><i className="ti ti-pencil fin-edit-hint" aria-hidden="true" /></button>)}
  </section>;
}
