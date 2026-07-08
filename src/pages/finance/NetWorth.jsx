import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Card from '../../components/shared/Card.jsx';
import { useCrud } from '../../lib/useData.js';
import { ACCOUNT_TYPES } from '../../lib/mockData.js';
import { currency, compactCurrency, formatDate } from '../../lib/helpers.js';

const PIE_COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];

function AccountRow({ a, patch, remove }) {
  return (
    <div className="edit-row">
      <input className="input" value={a.name || ''} onChange={(e) => patch(a.id, { name: e.target.value })} placeholder="Account" style={{ flex: 2 }} />
      <select className="select" value={a.type || 'Checking'} onChange={(e) => patch(a.id, { type: e.target.value })} style={{ width: 120 }}>
        {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      <input className="input" type="number" value={a.balance ?? ''} onChange={(e) => patch(a.id, { balance: e.target.value === '' ? 0 : Number(e.target.value) })} style={{ width: 110 }} />
      <button className="btn btn--ghost btn--icon" onClick={() => remove(a.id)} title="Delete"><i className="ti ti-trash" /></button>
    </div>
  );
}

export default function NetWorth() {
  const { rows: accounts, add, patch, remove } = useCrud('accounts');
  const snapshots = useCrud('net_worth_snapshots', 'snapshot_date');

  const isLiability = (a) => a.type === 'Liability';
  const assets = accounts.filter((a) => !isLiability(a));
  const liabilities = accounts.filter(isLiability);
  const totalAssets = assets.reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalLiab = liabilities.reduce((s, a) => s + Number(a.balance || 0), 0);
  const netWorth = totalAssets - totalLiab;

  const pieData = Object.entries(
    assets.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + Number(a.balance || 0); return acc; }, {})
  ).map(([name, value]) => ({ name, value }));

  const chartData = snapshots.rows.map((s) => ({ date: formatDate(s.snapshot_date), total: Number(s.total) }));

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Net Worth</h1>
          <div className="page-header-sub">{accounts.length} accounts</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => snapshots.add({ total: netWorth })}><i className="ti ti-camera" /> Save Snapshot</button>
          <button className="btn btn--accent" onClick={() => add({ name: 'New account', type: 'Checking', balance: 0 })}><i className="ti ti-plus" /> Add Account</button>
        </div>
      </div>

      <Card className="card-section" static>
        <div className="section-label">Total Net Worth</div>
        <div className="metric-hero">{currency(netWorth)}</div>
        <div className="row gap-16 mt-16">
          <span className="text-green">Assets {compactCurrency(totalAssets)}</span>
          <span className="text-red">Liabilities {compactCurrency(totalLiab)}</span>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card className="card-section" static>
          <div className="card-section-title">Net Worth Over Time</div>
          {chartData.length === 0 ? (
            <p className="body-text">Tap "Save Snapshot" over time to chart your net worth.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e11d48" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e1818" vertical={false} />
                <XAxis dataKey="date" stroke="#8a7070" fontSize={11} />
                <YAxis stroke="#8a7070" fontSize={11} tickFormatter={(v) => compactCurrency(v)} />
                <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => currency(v)} />
                <Area type="monotone" dataKey="total" stroke="#e11d48" strokeWidth={2} fill="url(#nw)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="card-section" static>
          <div className="card-section-title">Asset Breakdown</div>
          {pieData.length === 0 ? (
            <p className="body-text">Add asset accounts to see a breakdown.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => currency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card className="card-section" static>
          <div className="card-section-title text-green">Assets</div>
          {assets.length === 0 && <p className="body-text">No asset accounts yet.</p>}
          {assets.map((a) => <AccountRow key={a.id} a={a} patch={patch} remove={remove} />)}
        </Card>
        <Card className="card-section" static>
          <div className="card-section-title text-red">Liabilities</div>
          {liabilities.length === 0 ? <p className="body-text">No liabilities. 🎉</p> : liabilities.map((a) => <AccountRow key={a.id} a={a} patch={patch} remove={remove} />)}
        </Card>
      </div>
    </div>
  );
}
