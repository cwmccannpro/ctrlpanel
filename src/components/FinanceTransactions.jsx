import { useState } from 'react';
import { financeMoney as currency } from '../lib/financeSheet.js';

export default function FinanceTransactions({ summary, data, onEdit, onAdd, compact = false }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const size = compact ? 5 : 12;
  const rows = [...summary.transactions].sort((a, b) => b.date.localeCompare(a.date)).filter((t) => `${t.name} ${t.notes}`.toLowerCase().includes(query.toLowerCase()));
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  return <section className="fin-section">
    <div className="fin-section-head"><div><h2>Recent activity</h2><p>{summary.transactions.length ? `${summary.transactions.length} records this month` : 'Your recorded money movements'}</p></div><button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Log transaction</button></div>
    {!compact && !!summary.transactions.length && <label className="fin-search"><i className="ti ti-search" aria-hidden="true" /><input className="input" aria-label="Search transactions" placeholder="Find a transaction" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>}
    {!rows.length && <div className="fin-empty">{query ? 'No matching transactions.' : 'No transactions recorded this month. Log expenses and income to see actual cashflow.'}</div>}
    {rows.slice(safePage * size, (safePage + 1) * size).map((t) => <button key={t.id} className="fin-transaction" onClick={() => onEdit(t)}>
      <span className={`fin-transaction-icon fin-transaction-icon--${t.type.toLowerCase()}`}><i className={`ti ${t.type === 'Income' ? 'ti-arrow-down-left' : t.type === 'Transfer' ? 'ti-arrows-exchange' : 'ti-arrow-up-right'}`} aria-hidden="true" /></span>
      <span className="fin-transaction-name"><strong>{t.name}</strong><span>{t.date} · {data.budget?.find((c) => c.id === t.category_id)?.name || t.type}</span></span><strong className={t.type === 'Income' ? 'text-green' : ''}>{t.type === 'Income' ? '+' : t.type === 'Expense' ? '−' : ''}{currency(t.amount)}</strong><i className="ti ti-pencil fin-edit-hint" aria-hidden="true" />
    </button>)}
    {!compact && rows.length > size && <div className="fin-pagination"><button className="btn btn--sm" disabled={!safePage} onClick={() => setPage(safePage - 1)}>Previous</button><span>{safePage + 1} / {Math.ceil(rows.length / size)}</span><button className="btn btn--sm" disabled={(safePage + 1) * size >= rows.length} onClick={() => setPage(safePage + 1)}>Next</button></div>}
  </section>;
}
