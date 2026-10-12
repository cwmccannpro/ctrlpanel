import { financeMoney as currency } from '../lib/financeSheet.js';

export default function FinanceInsights({ summary: s }) {
  const signals = [
    s.unknownBalances > 0 ? { icon: 'ti-alert-circle', title: `${s.unknownBalances} balances need an update`, text: 'Your totals use known balances. Complete these accounts before saving a snapshot.', tone: 'amber' } : { icon: 'ti-check', title: 'Your balances are complete', text: 'Every account has a recorded balance.', tone: 'green' },
    { icon: 'ti-shield', title: s.reserve === null ? 'Build your spending plan' : `${s.reserve.toFixed(1)} months of cash reserve`, text: 'Cash accounts divided by planned monthly bills. Investments and expected funds are excluded.', tone: 'accent' },
    { icon: 'ti-arrows-exchange', title: `${currency(Math.abs(s.plannedSavings))} planned ${s.plannedSavings >= 0 ? 'surplus' : 'shortfall'}`, text: 'Recurring take-home income less your monthly plan. Actuals come from recorded transactions.', tone: s.plannedSavings >= 0 ? 'green' : 'red' },
  ];
  if (s.unassigned) signals.push({ icon: 'ti-tags', title: `${currency(s.unassigned)} needs a category`, text: 'Assign these expenses to keep category progress accurate.', tone: 'amber' });
  return <section className="fin-section fin-insights"><div className="fin-section-head"><div><h3>What deserves your attention</h3><p>Signals from your numbers</p></div><i className="ti ti-sparkles" aria-hidden="true" /></div><div className="fin-insight-list">{signals.map((a) => <div className="fin-insight" key={a.title}><i className={`ti ${a.icon}`} style={{ color: `var(--${a.tone})` }} aria-hidden="true" /><div><strong>{a.title}</strong><p>{a.text}</p></div></div>)}</div></section>;
}
