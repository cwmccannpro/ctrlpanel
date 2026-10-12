import { useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { compactCurrency } from '../lib/helpers.js';
import { financeMoney as currency } from '../lib/financeSheet.js';

const colors = ['var(--accent)', 'var(--blue)', 'var(--amber)', 'var(--green)'];
export default function FinanceChart({ history = [], allocation, height = 240, compact = false, label = 'Net worth' }) {
  const id = useId().replace(/:/g, '');
  const tip = { background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 12 };
  if (allocation) {
    const data = allocation.filter((d) => d.value > 0);
    if (!data.length) return <div className="fin-chart-empty">Add known asset balances to see your allocation.</div>;
    return <figure className={`fin-allocation ${compact ? 'fin-allocation--compact' : ''}`}>
      <div className="fin-donut"><ResponsiveContainer width="100%" height={compact ? 130 : 190}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={compact ? 40 : 58} outerRadius={compact ? 56 : 78} paddingAngle={4} stroke="none" isAnimationActive={false}>{data.map((d, i) => <Cell key={d.name} fill={colors[i % colors.length]} />)}</Pie><Tooltip formatter={(v) => currency(v)} contentStyle={tip} /></PieChart></ResponsiveContainer></div>
      <figcaption className="fin-legend">{data.map((d, i) => <div key={d.name}><span className="fin-legend-dot" style={{ background: colors[i % colors.length] }} /><span>{d.name}</span><strong>{currency(d.value)}</strong></div>)}</figcaption>
    </figure>;
  }
  const data = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (data.length < 2) return <div className="fin-chart-empty"><i className="ti ti-chart-line" aria-hidden="true" /><strong>Your financial story starts here</strong><span>Save snapshots over time to reveal your {label.toLowerCase()} trend.</span>{data.length === 1 && <span>First snapshot: {currency(data[0].net_worth)}</span>}</div>;
  return <figure><div role="img" aria-label={`${label} from ${data[0].date} to ${data.at(-1).date}: ${currency(data[0].net_worth)} to ${currency(data.at(-1).net_worth)}`}><ResponsiveContainer width="100%" height={height}><AreaChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: compact ? -30 : 0 }}>
    <defs><linearGradient id={`fin-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
    <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="var(--text-secondary)" fontSize={10} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickFormatter={compactCurrency} stroke="var(--text-secondary)" fontSize={10} tickLine={false} axisLine={false} width={compact ? 60 : 75} /><Tooltip contentStyle={tip} formatter={(v) => [currency(v), label]} /><Area type="monotone" dataKey="net_worth" stroke="var(--accent)" strokeWidth={2} fill={`url(#fin-${id})`} isAnimationActive={false} />
  </AreaChart></ResponsiveContainer></div></figure>;
}
