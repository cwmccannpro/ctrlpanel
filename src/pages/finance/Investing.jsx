import { useState, useEffect, useMemo } from 'react';
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
import { useCrud } from '../../lib/useData.js';
import { finance } from '../../lib/api.js';
import { ASSET_CLASSES } from '../../lib/mockData.js';
import { currency, compactCurrency, percent, formatDate } from '../../lib/helpers.js';

const PIE_COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];

export default function Investing() {
  const holdings = useCrud('holdings');
  const dividends = useCrud('dividends');
  const snapshots = useCrud('portfolio_snapshots', 'snapshot_date');
  const [prices, setPrices] = useState({});
  const [live, setLive] = useState(false);
  const [allocBy, setAllocBy] = useState('class');
  const [editHolding, setEditHolding] = useState(null);
  const [addDiv, setAddDiv] = useState(null);

  const tickers = useMemo(() => holdings.rows.map((h) => h.ticker).filter(Boolean), [holdings.rows]);
  const tickerKey = tickers.join(',');

  useEffect(() => {
    if (tickers.length === 0) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await finance.prices(tickers);
        if (active) { setPrices(data); setLive(true); }
      } catch {
        if (active) setLive(false);
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => { active = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  const enriched = holdings.rows.map((h) => {
    const price = prices[h.ticker]?.price ?? h.manual_price ?? h.avg_cost ?? 0;
    const dayChange = prices[h.ticker]?.change ?? 0;
    const value = Number(h.shares || 0) * price;
    const cost = Number(h.shares || 0) * Number(h.avg_cost || 0);
    const gain = value - cost;
    const gainPct = cost ? (gain / cost) * 100 : 0;
    return { ...h, price, value, gain, gainPct, dayChange };
  });

  const totalValue = enriched.reduce((s, h) => s + h.value, 0);
  const totalGain = enriched.reduce((s, h) => s + h.gain, 0);
  const totalCost = totalValue - totalGain;

  const allocData =
    allocBy === 'class'
      ? Object.entries(enriched.reduce((acc, h) => { acc[h.asset_class] = (acc[h.asset_class] || 0) + h.value; return acc; }, {})).map(([name, value]) => ({ name, value }))
      : enriched.map((h) => ({ name: h.ticker, value: h.value }));

  const perfData = snapshots.rows.map((s) => ({ date: formatDate(s.snapshot_date), value: Number(s.total_value) }));

  const saveHolding = () => {
    const h = editHolding;
    if (!h.ticker?.trim()) return;
    const payload = {
      ticker: h.ticker.toUpperCase(),
      name: h.name || null,
      asset_class: h.asset_class,
      shares: Number(h.shares) || 0,
      avg_cost: Number(h.avg_cost) || 0,
      manual_price: h.manual_price ? Number(h.manual_price) : null,
    };
    if (h.id && !String(h.id).startsWith('tmp-')) holdings.patch(h.id, payload);
    else holdings.add(payload);
    setEditHolding(null);
  };

  const saveDividend = () => {
    if (!addDiv.amount) return;
    dividends.add({ holding_id: addDiv.holding_id || null, amount: Number(addDiv.amount), paid_date: addDiv.paid_date });
    setAddDiv(null);
  };

  const tickerFor = (id) => holdings.rows.find((h) => h.id === id)?.ticker || '—';

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Investing</h1>
          <div className="page-header-sub row" style={{ gap: 6 }}>
            <span className={`status-dot ${live ? 'running' : 'stopped'}`} />
            {live ? 'Live prices · refreshes every 10s' : 'Live prices when holdings added'}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => snapshots.add({ total_value: totalValue })} title="Save a performance snapshot"><i className="ti ti-camera" /> Snapshot</button>
          <button className="btn" onClick={() => setAddDiv({ holding_id: holdings.rows[0]?.id, paid_date: new Date().toISOString().slice(0, 10) })}><i className="ti ti-plus" /> Dividend</button>
          <button className="btn btn--accent" onClick={() => setEditHolding({ asset_class: 'Stocks' })}><i className="ti ti-plus" /> Add Holding</button>
        </div>
      </div>

      <div className="grid grid-3">
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Portfolio Value</span><i className="ti ti-chart-pie" /></div><div className="stat-card-value">{currency(totalValue)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Total Gain/Loss</span><i className="ti ti-trending-up" /></div><div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{currency(totalGain)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Return</span><i className="ti ti-percentage" /></div><div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{percent(totalCost ? (totalGain / totalCost) * 100 : 0)}</div></Card>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">Holdings</div>
        {holdings.rows.length === 0 && <p className="body-text">No holdings yet. Add one to track live value and allocation.</p>}
        {holdings.rows.length > 0 && (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {['Ticker', 'Name', 'Class', 'Shares', 'Avg Cost', 'Price', 'Value', 'Gain/Loss $', 'Gain/Loss %', 'Day', ''].map((h, i) => (
                    <th key={i} style={{ cursor: 'default' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enriched.map((h) => (
                  <tr key={h.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{h.ticker}</td>
                    <td>{h.name}</td>
                    <td><span className="badge">{h.asset_class}</span></td>
                    <td>{h.shares}</td>
                    <td>{currency(h.avg_cost, { cents: true })}</td>
                    <td>{currency(h.price, { cents: true })}</td>
                    <td>{currency(h.value)}</td>
                    <td className={h.gain >= 0 ? 'text-green' : 'text-red'}>{currency(h.gain)}</td>
                    <td className={h.gain >= 0 ? 'text-green' : 'text-red'}>{percent(h.gainPct)}</td>
                    <td className={h.dayChange >= 0 ? 'text-green' : 'text-red'}>{percent(h.dayChange)}</td>
                    <td>
                      <div className="row">
                        <button className="btn btn--ghost btn--icon" onClick={() => setEditHolding(h)} title="Edit"><i className="ti ti-pencil" /></button>
                        <button className="btn btn--ghost btn--icon" onClick={() => holdings.remove(h.id)} title="Delete"><i className="ti ti-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Allocation</span>
            <div className="segmented">
              <button className={allocBy === 'class' ? 'active' : ''} onClick={() => setAllocBy('class')}>By Class</button>
              <button className={allocBy === 'holding' ? 'active' : ''} onClick={() => setAllocBy('holding')}>By Holding</button>
            </div>
          </div>
          {allocData.length === 0 ? (
            <p className="body-text">Add holdings to see allocation.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={allocData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {allocData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => currency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="card-section" static>
          <div className="card-section-title">Performance</div>
          {perfData.length === 0 ? (
            <p className="body-text">Tap "Snapshot" over time to build a performance history.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={perfData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e1818" vertical={false} />
                <XAxis dataKey="date" stroke="#8a7070" fontSize={11} />
                <YAxis stroke="#8a7070" fontSize={11} tickFormatter={(v) => compactCurrency(v)} />
                <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => currency(v)} />
                <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#perf)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="card-section" static>
        <div className="card-section-title">Dividends</div>
        {dividends.rows.length === 0 && <p className="body-text">No dividends logged.</p>}
        {dividends.rows.map((d) => (
          <div className="list-row" key={d.id}>
            <span className="badge">{tickerFor(d.holding_id)}</span>
            <span className="list-row-title text-green">{currency(d.amount, { cents: true })}</span>
            <span className="list-row-meta">{formatDate(d.paid_date)}</span>
            <button className="btn btn--ghost btn--icon" onClick={() => dividends.remove(d.id)} title="Delete"><i className="ti ti-x" /></button>
          </div>
        ))}
      </Card>

      {editHolding && (
        <Modal
          title={editHolding.id ? 'Edit Holding' : 'Add Holding'}
          onClose={() => setEditHolding(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setEditHolding(null)}>Cancel</button><button className="btn btn--accent" onClick={saveHolding}>Save</button></>}
        >
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Ticker</label><input className="input" value={editHolding.ticker || ''} onChange={(e) => setEditHolding({ ...editHolding, ticker: e.target.value })} autoFocus /></div>
            <div className="field"><label className="field-label">Asset Class</label><select className="select" value={editHolding.asset_class} onChange={(e) => setEditHolding({ ...editHolding, asset_class: e.target.value })}>{ASSET_CLASSES.map((a) => <option key={a}>{a}</option>)}</select></div>
          </div>
          <div className="field"><label className="field-label">Name</label><input className="input" value={editHolding.name || ''} onChange={(e) => setEditHolding({ ...editHolding, name: e.target.value })} /></div>
          <div className="grid grid-3">
            <div className="field"><label className="field-label">Shares</label><input className="input" type="number" value={editHolding.shares ?? ''} onChange={(e) => setEditHolding({ ...editHolding, shares: e.target.value })} /></div>
            <div className="field"><label className="field-label">Avg Cost</label><input className="input" type="number" value={editHolding.avg_cost ?? ''} onChange={(e) => setEditHolding({ ...editHolding, avg_cost: e.target.value })} /></div>
            <div className="field"><label className="field-label">Manual Price</label><input className="input" type="number" value={editHolding.manual_price ?? ''} onChange={(e) => setEditHolding({ ...editHolding, manual_price: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {addDiv && (
        <Modal
          title="Add Dividend"
          onClose={() => setAddDiv(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddDiv(null)}>Cancel</button><button className="btn btn--accent" onClick={saveDividend}>Save</button></>}
        >
          <div className="field"><label className="field-label">Holding</label>
            <select className="select" value={addDiv.holding_id || ''} onChange={(e) => setAddDiv({ ...addDiv, holding_id: e.target.value })}>
              <option value="">—</option>
              {holdings.rows.map((h) => <option key={h.id} value={h.id}>{h.ticker}</option>)}
            </select>
          </div>
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Amount ($)</label><input className="input" type="number" value={addDiv.amount || ''} onChange={(e) => setAddDiv({ ...addDiv, amount: e.target.value })} autoFocus /></div>
            <div className="field"><label className="field-label">Paid Date</label><input className="input" type="date" value={addDiv.paid_date} onChange={(e) => setAddDiv({ ...addDiv, paid_date: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
