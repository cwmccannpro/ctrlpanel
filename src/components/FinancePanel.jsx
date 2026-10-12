import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import useFinance from '../lib/useFinance.js';
import { financeSummary, financeDay } from '../lib/financeSheet.js';
import { financeMoney as currency } from '../lib/financeSheet.js';
import FinanceChart from './FinanceChart.jsx';
import '../styles/finance.css';

const labels = { networth: ['Net worth', '/finance/networth'], cashflow: ['Cashflow', '/finance/budget'], budget: ['Spending plan', '/finance/budget'], investing: ['Investments', '/finance/investing'], reserve: ['Cash reserve', '/finance'], debt: ['Debt', '/finance/debt'] };
export default function FinancePanel({ kind = 'networth', cfg = {}, onCfg = () => {} }) {
  const f = useFinance();
  const ref = new Date();
  if (cfg.period === 'previous') ref.setMonth(ref.getMonth() - 1, 1);
  const month = financeDay(ref).slice(0, 7);
  const s = useMemo(() => financeSummary(f.data, month), [f.data, month]);
  const [defaultLabel, to] = labels[kind];
  const label = !f.includeDebt && kind === 'networth' ? 'Total assets' : defaultLabel;
  if (!f.includeDebt && kind === 'debt') return null;
  const list = (f.data.accounts || []).filter((a) => kind === 'debt' ? a.type === 'Liability' : ['Investment', 'Crypto'].includes(a.type)).sort((a, b) => (b.balance || 0) - (a.balance || 0));
  return <div className="fin-panel">
    <div className="dash2-panel-head"><Link className="dash2-panel-title dash2-link" to={to}>{label}</Link>{f.connected && <span className="fin-panel-source"><span className={`fin-status-dot ${f.error ? 'fin-status-dot--error' : ''}`} /> Sheets</span>}</div>
    {f.loading && !f.refreshedAt ? <div className="fin-panel-empty" role="status">Reading your workbook…</div> : !f.connected ? <div className="fin-panel-empty">{f.error?.message || 'Bring your finances into focus.'}<Link to="/finance">Connect Google Sheets <i className="ti ti-arrow-right" aria-hidden="true" /></Link></div> : <>
      {f.error && <div className="fin-panel-notice">Refresh failed · showing the last read <button className="fin-text-button" onClick={() => f.reload().catch(() => {})}>Retry</button></div>}
      {['networth', 'cashflow', 'investing', 'debt', 'reserve'].includes(kind) && <div><div className="fin-panel-value">{kind === 'reserve' ? s.reserve === null ? '—' : `${s.reserve.toFixed(1)} mo` : currency(kind === 'networth' ? s.netWorth : kind === 'cashflow' ? s.plannedSavings : kind === 'investing' ? s.investments : s.debt)}</div><p className="fin-panel-caption">{kind === 'networth' ? f.includeDebt ? 'Known assets less liabilities' : 'Known asset balances' : kind === 'cashflow' ? 'Planned monthly surplus' : kind === 'investing' ? 'Known investment account balances' : kind === 'reserve' ? 'Available cash / planned monthly bills' : 'Outstanding balances'}</p></div>}
      {kind === 'networth' && <><div className="fin-panel-pair"><div><span>Assets</span><strong>{currency(s.assets)}</strong></div>{f.includeDebt && <div><span>Liabilities</span><strong>{currency(s.debt)}</strong></div>}</div>{s.unknownBalances > 0 && <p className="fin-panel-notice"><i className="ti ti-alert-circle" aria-hidden="true" />{s.unknownBalances} balances are unknown</p>}{(f.data.history || []).length >= 2 && <FinanceChart history={f.data.history} label={label} compact height={110} />}</>}
      {kind === 'cashflow' && <><div className="fin-panel-pair"><div><span>Take-home plan</span><strong>{currency(s.plannedIncome)}</strong></div><div><span>Monthly bills</span><strong>{currency(s.plannedExpenses)}</strong></div></div><label className="fin-panel-select">Activity<select value={cfg.period || 'current'} onChange={(e) => onCfg({ period: e.target.value })}><option value="current">This month</option><option value="previous">Last month</option></select></label><div className="fin-panel-pair"><div><span>Recorded income</span><strong>{currency(s.earned)}</strong></div><div><span>Recorded expenses</span><strong>{currency(s.spent)}</strong></div></div><span className="fin-panel-caption">{s.transactions.length} logged transactions · {month}</span></>}
      {kind === 'budget' && <><div className="fin-panel-pair"><div><span>Monthly plan</span><strong>{currency(s.plannedExpenses)}</strong></div><div><span>Recorded spend</span><strong>{currency(s.spent)}</strong></div></div>{s.categories.length ? [...s.categories].sort((a, b) => b.budgeted - a.budgeted).slice(0, 5).map((c) => <Link to="/finance/budget" className="fin-panel-budget" key={c.id}><div><span>{c.name}</span><strong>{currency(c.spent)} / {currency(c.budgeted)}</strong></div><div className="fin-budget-track"><span style={{ width: `${Math.min(100, c.ratio * 100)}%`, background: c.ratio > 1 ? 'var(--red)' : 'var(--accent)' }} /></div></Link>) : <div className="fin-panel-caption">Add categories to build a spending plan.</div>}</>}
      {['investing', 'debt'].includes(kind) && <>{list.slice(0, 5).map((a) => <Link to={to} className="fin-panel-row" key={a.id}><span>{a.name}</span><strong>{a.balance === null ? 'Unknown' : currency(a.balance)}</strong></Link>)}{!list.length && <span className="fin-panel-caption">Add {kind === 'debt' ? 'liability' : 'investment'} accounts in Finance.</span>}</>}
      {kind === 'reserve' && <><div className="fin-panel-pair"><div><span>Available cash</span><strong>{currency(s.cash)}</strong></div><div><span>Monthly bills</span><strong>{currency(s.plannedExpenses)}</strong></div></div><p className="fin-panel-caption">Expected funds and investments stay outside this reserve.</p></>}
    </>}
  </div>;
}
