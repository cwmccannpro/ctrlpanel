import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import useFinance from '../lib/useFinance.js';
import { financeSummary, financeDay } from '../lib/financeSheet.js';
import { financeMoney as currency } from '../lib/financeSheet.js';
import { useToast } from './Toaster.jsx';
import FinanceConnection from './FinanceConnection.jsx';
import FinanceRecordEditor from './FinanceRecordEditor.jsx';
import FinanceSection from './FinanceSection.jsx';
import FinanceAccounts from './FinanceAccounts.jsx';
import FinanceChart from './FinanceChart.jsx';
import FinanceBudgetCategories from './FinanceBudgetCategories.jsx';
import FinanceIncome from './FinanceIncome.jsx';
import FinanceTransactions from './FinanceTransactions.jsx';
import FinanceInsights from './FinanceInsights.jsx';
import FinanceHoldings from './FinanceHoldings.jsx';
import FinanceMarket from './FinanceMarket.jsx';
import FinanceGoals from './FinanceGoals.jsx';
import '../styles/finance.css';

// Everything lives on one page; these ids are the anchors for the jump nav and for old /finance/* links.
const SECTIONS = [['overview', 'Overview', 'ti-layout-dashboard'], ['assets', 'Assets', 'ti-wallet'], ['cashflow', 'Cashflow', 'ti-arrows-exchange'], ['investing', 'Investing', 'ti-chart-line'], ['goals', 'Goals', 'ti-target']];
const INVESTMENT_TYPES = ['Investment', 'Crypto'];

export default function FinanceDashboard() {
  const f = useFinance();
  const [params] = useSearchParams();
  const location = useLocation();
  const toast = useToast();
  const [connecting, setConnecting] = useState(() => Boolean(params.get('connect')));
  const [editing, setEditing] = useState(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const [month, setMonth] = useState(financeDay().slice(0, 7));
  const [disconnecting, setDisconnecting] = useState(false);
  const s = useMemo(() => financeSummary(f.data, month), [f.data, month]);
  const data = f.data || {};
  const accounts = data.accounts || [];
  const ready = f.connected && Boolean(f.refreshedAt);
  const edit = (table, row = null) => setEditing({ table, row });
  const doSnapshot = async () => { setSnapshotting(true); try { await f.snapshot(financeDay()); toast('Snapshot saved to Google Sheets'); } catch (e) { toast({ tone: 'error', message: e.message }); } finally { setSnapshotting(false); } };
  const shiftMonth = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); setMonth(financeDay(d).slice(0, 7)); };
  const allocation = [{ name: 'Cash', value: s.cash }, { name: 'Investments', value: s.investments }, { name: 'Other assets', value: s.other }, { name: 'Expected funds', value: s.receivables }];
  const metrics = [['Available cash', s.cash, 'Cash accounts only'], ['Investments', s.investments, 'Account balances · known values'], ['Expected funds', s.receivables, 'Receivables · separate from cash'], ['Planned surplus', s.plannedSavings, 'Monthly income less budget']];
  const cashflowMetrics = [['Take-home plan', s.plannedIncome, 'Recurring · net pay only'], ['Monthly budget', s.plannedExpenses, 'Your spending plan'], ['Recorded expenses', s.spent, `${s.transactions.length} transactions this month`], ['Budget remaining', s.plannedExpenses - s.spent, 'Budget less logged expenses']];

  // Sections only exist once the workbook has loaded, so scroll to the requested one then.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (ready && SECTIONS.some(([section]) => section === id)) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [location.hash, ready]);

  return <div className="fin-page fade-in">
    <header className="fin-header"><div><span className="fin-eyebrow">PERSONAL FINANCE</span><h1>Finance<span>.</span></h1><p>Balances, cashflow, investments and goals in one place.</p></div><div className="fin-header-actions">
      {f.connected && <><a className="btn btn--sm" href={f.connection.url} target="_blank" rel="noreferrer"><i className="ti ti-external-link" aria-hidden="true" /> Open Sheet</a><button className="btn btn--sm" onClick={() => f.reload().catch(() => {})} disabled={f.loading}><i className={`ti ti-refresh ${f.loading ? 'fin-spinning' : ''}`} aria-hidden="true" /> Refresh</button></>}
      <button className="btn btn--sm" onClick={() => setConnecting(true)}><i className="ti ti-link" aria-hidden="true" /> {f.connected ? 'Source' : 'Connect Sheets'}</button>
    </div></header>
    {f.connected && <nav className="fin-jump segmented" aria-label="Finance sections">{SECTIONS.map(([id, label, icon]) => <a key={id} href={`#${id}`}><i className={`ti ${icon}`} aria-hidden="true" />{label}</a>)}</nav>}
    {f.error && <div className="fin-error" role="alert"><strong>Finance refresh failed.</strong> {f.error.message}<button className="btn btn--sm" onClick={() => f.reload().catch(() => {})}>Try again</button></div>}
    {f.loading && !f.refreshedAt && !f.error ? <div className="fin-loading" role="status"><span className="fin-skeleton" /><span className="fin-skeleton" /><p>Reading your finance workbook…</p></div> : !f.connected ? <section className="fin-welcome"><div className="fin-welcome-art"><i className="ti ti-building-bank" aria-hidden="true" /><span className="fin-welcome-line" /></div><span className="fin-eyebrow">ONE SOURCE. EVERY VIEW.</span><h2>Your money, in focus.</h2><p>Connect a private Google Sheet to turn your balances, bills, and transactions into a finance dashboard you can edit.</p><button className="btn btn--accent" onClick={() => setConnecting(true)}><i className="ti ti-link" aria-hidden="true" /> Connect finance workbook</button><div className="fin-welcome-features"><span><i className="ti ti-arrows-exchange" aria-hidden="true" /> Direct edits to Sheets</span><span><i className="ti ti-lock" aria-hidden="true" /> Private to your account</span><span><i className="ti ti-layout-dashboard" aria-hidden="true" /> Matching dashboard widgets</span></div></section> : <>
      <div className="fin-source-status"><span className={`fin-status-dot ${f.error ? 'fin-status-dot--error' : ''}`} /><span>{f.connection.title}</span><span className="fin-source-separator">/</span><span>{f.error ? 'Showing last successful read' : f.loading ? 'Refreshing…' : `Read at ${new Date(f.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span><span className="fin-spacer" /><button onClick={() => setDisconnecting(true)} className="fin-text-button">Unlink</button></div>
      {disconnecting && <div className="fin-error">Unlink this workbook? Your sheet and its data will remain intact.<button className="btn btn--sm" onClick={async () => { try { await f.disconnect(); setDisconnecting(false); } catch (e) { toast({ tone: 'error', message: e.message }); } }}>Unlink workbook</button><button className="btn btn--ghost btn--sm" onClick={() => setDisconnecting(false)}>Keep connected</button></div>}

      <div id="overview" className="fin-block fin-overview">
        <section className="fin-hero"><div className="fin-hero-main"><span className="fin-eyebrow">TOTAL ASSETS</span><div className="fin-hero-value">{currency(s.netWorth)}</div><div className="fin-hero-foot"><span className="fin-chip">{s.unknownBalances ? `${s.unknownBalances} unknown balances` : 'All balances recorded'}</span><span>USD · From your source workbook</span></div></div><div className="fin-hero-aside"><span className="fin-eyebrow">CASH RESERVE</span><strong>{s.reserve === null ? '—' : s.reserve.toFixed(1)}<small>months</small></strong><p>Available cash / planned monthly bills</p>{s.savingsRate !== null && <span className="fin-chip">{(s.savingsRate * 100).toFixed(0)}% planned savings rate</span>}</div></section>
        <div className="fin-metrics">{metrics.map(([label, value, caption]) => <div key={label}><span>{label}</span><strong>{currency(value)}</strong><small>{caption}</small></div>)}</div>
        <div className="fin-two-col"><section className="fin-section"><div className="fin-section-head"><div><h3>Total assets over time</h3><p>Real snapshots from your workbook</p></div><button className="btn btn--sm" disabled={snapshotting || !!s.unknownBalances || !!f.error} onClick={doSnapshot} title={s.unknownBalances ? 'Update unknown balances first' : 'Save today’s known balances'}><i className="ti ti-camera" aria-hidden="true" /> {snapshotting ? 'Saving…' : 'Save snapshot'}</button></div><FinanceChart history={data.history} label="Total assets" /></section><section className="fin-section"><div className="fin-section-head"><div><h3>Where your assets sit</h3><p>Cash, investments, and expected funds</p></div></div><FinanceChart allocation={allocation} /></section></div>
        <FinanceInsights summary={s} />
      </div>

      <FinanceSection id="assets" number="01" title="Assets" subtitle="Cash, expected funds and everything else you own." icon="ti-wallet">
        <FinanceAccounts rows={accounts.filter((a) => a.type !== 'Liability' && !INVESTMENT_TYPES.includes(a.type))} onEdit={(r) => edit('accounts', r)} onAdd={() => edit('accounts')} title="Accounts & available funds" />
      </FinanceSection>

      <FinanceSection id="cashflow" number="02" title="Cashflow" subtitle="Your monthly plan against what actually moved." icon="ti-arrows-exchange">
        <div className="fin-month-controls"><button className="btn btn--icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}><i className="ti ti-chevron-left" aria-hidden="true" /></button><label><span className="sr-only">Activity month</span><input className="input" type="month" value={month} required onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} /></label><button className="btn btn--icon" aria-label="Next month" onClick={() => shiftMonth(1)}><i className="ti ti-chevron-right" aria-hidden="true" /></button><span>Activity month · your monthly plan is recurring</span></div>
        <div className="fin-metrics">{cashflowMetrics.map(([label, value, caption]) => <div key={label}><span>{label}</span><strong>{currency(value)}</strong><small>{caption}</small></div>)}</div>
        <div className="fin-two-col"><div className="fin-stack"><FinanceBudgetCategories summary={s} onEdit={(r) => edit('budget', r)} onAdd={() => edit('budget')} /><FinanceIncome rows={data.income} onEdit={(r) => edit('income', r)} onAdd={() => edit('income')} /></div><FinanceTransactions summary={s} data={data} onAdd={() => edit('transactions')} onEdit={(r) => edit('transactions', r)} /></div>
      </FinanceSection>

      <FinanceSection id="investing" number="03" title="Investing" subtitle="Account balances and the positions behind them." icon="ti-chart-line">
        <FinanceMarket holdings={data.holdings} />
        <div className="fin-two-col"><FinanceAccounts rows={accounts.filter((a) => INVESTMENT_TYPES.includes(a.type))} onEdit={(r) => edit('accounts', r)} onAdd={() => edit('accounts')} title="Investment accounts" /><FinanceHoldings rows={data.holdings} accounts={accounts} onEdit={(r) => edit('holdings', r)} onAdd={() => edit('holdings')} /></div>
        <p className="fin-caption">Account totals power your asset balance. Individual positions are tracked separately to prevent double-counting.</p>
      </FinanceSection>

      <FinanceSection id="goals" number="04" title="Goals" subtitle="The targets you are working toward." icon="ti-target">
        <FinanceGoals rows={data.goals} onEdit={(r) => edit('goals', r)} onAdd={() => edit('goals')} />
      </FinanceSection>

      <footer className="fin-footer"><i className="ti ti-lock" aria-hidden="true" /> Your Google Sheet is the source of truth. Edits save there; views refresh every minute.</footer>
    </>}
    {connecting && <FinanceConnection finance={f} initialUrl={params.get('connect') || ''} onClose={() => setConnecting(false)} />}{editing && <FinanceRecordEditor key={`${editing.table}-${editing.row?.id || 'new'}`} {...editing} finance={f} onClose={() => setEditing(null)} />}
  </div>;
}
