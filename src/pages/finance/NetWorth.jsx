import { useState } from 'react';
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
import Modal from '../../components/shared/Modal.jsx';
import { useRows } from '../../lib/useData.js';
import { update as sbUpdate, insert as sbInsert } from '../../lib/supabase.js';
import { mockAccounts, mockNetWorthHistory, ACCOUNT_TYPES } from '../../lib/mockData.js';
import { currency, compactCurrency } from '../../lib/helpers.js';

const PIE_COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];
let tmpId = 0;

export default function NetWorth() {
  const { rows: accounts, setRows: setAccounts, usingMock } = useRows('accounts', mockAccounts);
  const [snapshots, setSnapshots] = useState(mockNetWorthHistory);
  const [editId, setEditId] = useState(null);
  const [adding, setAdding] = useState(null);

  const isLiability = (a) => a.type === 'Liability';
  const assets = accounts.filter((a) => !isLiability(a));
  const liabilities = accounts.filter(isLiability);
  const totalAssets = assets.reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalLiab = liabilities.reduce((s, a) => s + Number(a.balance || 0), 0);
  const netWorth = totalAssets - totalLiab;

  const pieData = Object.entries(
    assets.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + Number(a.balance || 0);
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const saveBalance = (id, value) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, balance: Number(value) || 0 } : a)));
    sbUpdate('accounts', id, { balance: Number(value) || 0 });
    setEditId(null);
  };

  const saveSnapshot = () => {
    const label = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setSnapshots((prev) => [...prev, { date: label, total: netWorth }]);
    sbInsert('net_worth_snapshots', [{ total: netWorth }]);
  };

  const saveNew = () => {
    if (!adding.name?.trim()) return;
    const created = { ...adding, id: `new-${Date.now()}-${tmpId++}`, balance: Number(adding.balance) || 0 };
    setAccounts((prev) => [...prev, created]);
    sbInsert('accounts', [{ name: adding.name, type: adding.type, balance: Number(adding.balance) || 0 }]);
    setAdding(null);
  };

  const AccountRow = (a) => (
    <div className="list-row" key={a.id}>
      <span className="list-row-title">{a.name}</span>
      <span className="badge">{a.type}</span>
      {editId === a.id ? (
        <input
          className="cell-input"
          type="number"
          autoFocus
          defaultValue={a.balance}
          style={{ width: 120 }}
          onBlur={(e) => saveBalance(a.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveBalance(a.id, e.target.value)}
        />
      ) : (
        <span
          className="list-row-meta editable"
          style={{ cursor: 'text', color: 'var(--text-primary)', minWidth: 90, textAlign: 'right' }}
          onClick={() => setEditId(a.id)}
        >
          {currency(a.balance)}
        </span>
      )}
    </div>
  );

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Net Worth</h1>
          <div className="page-header-sub">{accounts.length} accounts {usingMock && '· demo data'}</div>
        </div>
        <div className="row">
          <button className="btn" onClick={saveSnapshot}><i className="ti ti-camera" /> Save Snapshot</button>
          <button className="btn btn--accent" onClick={() => setAdding({ type: 'Checking' })}><i className="ti ti-plus" /> Add Account</button>
        </div>
      </div>

      {/* Hero */}
      <Card className="card-section" static>
        <div className="section-label">Total Net Worth</div>
        <div className="metric-hero">{currency(netWorth)}</div>
        <div className="row gap-16 mt-16">
          <span className="text-green">Assets {compactCurrency(totalAssets)}</span>
          <span className="text-red">Liabilities {compactCurrency(totalLiab)}</span>
        </div>
      </Card>

      <div className="grid grid-2">
        {/* Net worth over time */}
        <Card className="card-section" static>
          <div className="card-section-title">Net Worth Over Time</div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={snapshots} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e11d48" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="date" stroke="#8a7070" fontSize={11} />
              <YAxis stroke="#8a7070" fontSize={11} tickFormatter={(v) => compactCurrency(v)} />
              <Tooltip
                contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => currency(v)}
              />
              <Area type="monotone" dataKey="total" stroke="#e11d48" strokeWidth={2} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Breakdown */}
        <Card className="card-section" static>
          <div className="card-section-title">Asset Breakdown</div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => currency(v)}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card className="card-section" static>
          <div className="card-section-title text-green">Assets</div>
          {assets.map(AccountRow)}
        </Card>
        <Card className="card-section" static>
          <div className="card-section-title text-red">Liabilities</div>
          {liabilities.length ? liabilities.map(AccountRow) : <p className="body-text">No liabilities. 🎉</p>}
        </Card>
      </div>

      {adding && (
        <Modal
          title="Add Account"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--accent" onClick={saveNew}>Save</button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Name</label>
            <input className="input" value={adding.name || ''} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="field-label">Type</label>
              <select className="select" value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
                {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Balance</label>
              <input className="input" type="number" value={adding.balance || ''} onChange={(e) => setAdding({ ...adding, balance: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
