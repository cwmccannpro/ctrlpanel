import { financeMoney as currency } from '../lib/financeSheet.js';

const icons = { Cash: 'ti-wallet', Investment: 'ti-chart-line', Crypto: 'ti-currency-bitcoin', Receivable: 'ti-hourglass', Liability: 'ti-credit-card', Other: 'ti-diamond', Vehicle: 'ti-car', Property: 'ti-home' };
export default function FinanceAccounts({ rows = [], onEdit, onAdd, title = 'Accounts' }) {
  return <section className="fin-section">
    <div className="fin-section-head"><div><h2>{title}</h2><p>Balances in your Google Sheet</p></div><button className="btn btn--sm" onClick={onAdd}><i className="ti ti-plus" aria-hidden="true" /> Add account</button></div>
    {!rows.length ? <p className="fin-empty">Add an account to bring this part of your finances into focus.</p> : <div className="fin-account-grid">{rows.map((a) => <button className="fin-account" key={a.id} onClick={() => onEdit(a)} aria-label={`Edit ${a.name}, ${a.balance === null ? 'unknown balance' : currency(a.balance)}`}>
      <div className="fin-account-top"><span className={`fin-account-icon ${a.type === 'Liability' ? 'fin-account-icon--debt' : ''}`}><i className={`ti ${icons[a.type] || 'ti-building-bank'}`} aria-hidden="true" /></span><span>{a.type}</span><i className="ti ti-pencil fin-edit-hint" aria-hidden="true" /></div>
      <strong>{a.name}</strong><span className={`fin-account-value ${a.balance === null ? 'fin-unknown' : ''}`}>{a.balance === null ? 'Unknown' : currency(a.balance)}</span>
      {a.notes && <p>{a.notes}</p>}{!!a.locked?.length && <span className="fin-caption">Contains calculated values</span>}
    </button>)}</div>}
  </section>;
}
