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
import { useRows } from '../../lib/useData.js';
import { insert as sbInsert } from '../../lib/supabase.js';
import { finance } from '../../lib/api.js';
import { mockHoldings, mockDividends, mockPortfolioHistory } from '../../lib/mockData.js';
import { currency, compactCurrency, percent } from '../../lib/helpers.js';

const ASSET_CLASSES = ['Stocks', 'ETFs', 'Crypto', 'Real Estate', 'Other'];
const PIE_COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];
let tmpId = 0;

export default function Investing() {
  const { rows: holdings, setRows: setHoldings, usingMock } = useRows('holdings', mockHoldings);
  const [prices, setPrices] = useState({});
  const [live, setLive] = useState(false);
  const [allocBy, setAllocBy] = useState('class');
  const [dividends, setDividends] = useState(mockDividends);
  const [addHolding, setAddHolding] = useState(null);
  const [addDiv, setAddDiv] = useState(null);

  const tickers = useMemo(() => holdings.map((h) => h.ticker), [holdings]);
  const tickerKey = tickers.join(',');

  // Poll live prices every 10 seconds (AGENTS.md)
  useEffect(() => {
    if (tickers.length === 0) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await finance.prices(tickers);
        if (active) {
          setPrices(data);
          setLive(true);
        }
      } catch {
        if (active) setLive(false);
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  const enriched = holdings.map((h) => {
    const livePrice = prices[h.ticker]?.price;
    const price = livePrice ?? h.manual_price ?? h.avg_cost;
    const dayChange = prices[h.ticker]?.change ?? 0;
    const value = h.shares * price;
    const cost = h.shares * h.avg_cost;
    const gain = value - cost;
    const gainPct = cost ? (gain / cost) * 100 : 0;
    return { ...h, price, value, gain, gainPct, dayChange };
  });

  const totalValue = enriched.reduce((s, h) => s + h.value, 0);
  const totalGain = enriched.reduce((s, h) => s + h.gain, 0);
  const totalCost = totalValue - totalGain;

  const allocData =
    allocBy === 'class'
      ? Object.entries(
          enriched.reduce((acc, h) => {
            acc[h.asset_class] = (acc[h.asset_class] || 0) + h.value;
            return acc;
          }, {})
        ).map(([name, value]) => ({ name, value }))
      : enriched.map((h) => ({ name: h.ticker, value: h.value }));

  const saveHolding = () => {
    if (!addHolding.ticker?.trim()) return;
    const h = {
      ...addHolding,
      id: `new-${Date.now()}-${tmpId++}`,
      shares: Number(addHolding.shares) || 0,
      avg_cost: Number(addHolding.avg_cost) || 0,
      manual_price: Number(addHolding.manual_price) || 0,
      ticker: addHolding.ticker.toUpperCase(),
    };
    setHoldings((prev) => [...prev, h]);
    sbInsert('holdings', [{ ticker: h.ticker, name: h.name, asset_class: h.asset_class, shares: h.shares, avg_cost: h.avg_cost, manual_price: h.manual_price }]);
    setAddHolding(null);
  };

  const saveDividend = () => {
    if (!addDiv.amount) return;
    const d = { ...addDiv, id: `new-${Date.now()}-${tmpId++}`, amount: Number(addDiv.amount) };
    setDividends((prev) => [d, ...prev]);
    sbInsert('dividends', [{ holding_id: d.holding, amount: d.amount, paid_date: d.paid_date }]);
    setAddDiv(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Investing</h1>
          <div className="page-header-sub row" style={{ gap: 6 }}>
            <span className={`status-dot ${live ? 'running' : 'stopped'}`} />
            {live ? 'Live prices · refreshes every 10s' : 'Using saved prices'} {usingMock && '· demo data'}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setAddDiv({ holding: holdings[0]?.ticker, paid_date: new Date().toISOString().slice(0, 10) })}><i className="ti ti-plus" /> Dividend</button>
          <button className="btn btn--accent" onClick={() => setAddHolding({ asset_class: 'Stocks' })}><i className="ti ti-plus" /> Add Holding</button>
        </div>
      </div>

      <div className="grid grid-3">
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Portfolio Value</span><i className="ti ti-chart-pie" /></div><div className="stat-card-value">{currency(totalValue)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Total Gain/Loss</span><i className="ti ti-trending-up" /></div><div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{currency(totalGain)}</div></Card>
        <Card className="stat-card"><div className="stat-card-head"><span className="section-label">Return</span><i className="ti ti-percentage" /></div><div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{percent(totalCost ? (totalGain / totalCost) * 100 : 0)}</div></Card>
      </div>

      {/* Holdings table */}
      <Card className="card-section" static>
        <div className="card-section-title">Holdings</div>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                {['Ticker', 'Name', 'Class', 'Shares', 'Avg Cost', 'Price', 'Value', 'Gain/Loss $', 'Gain/Loss %', 'Day'].map((h) => (
                  <th key={h} style={{ cursor: 'default' }}>{h}</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        {/* Allocation */}
        <Card className="card-section" static>
          <div className="card-section-title">
            <span>Allocation</span>
            <div className="segmented">
              <button className={allocBy === 'class' ? 'active' : ''} onClick={() => setAllocBy('class')}>By Class</button>
              <button className={allocBy === 'holding' ? 'active' : ''} onClick={() => setAllocBy('holding')}>By Holding</button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={allocData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {allocData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 }} formatter={(v) => currency(v)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Performance */}
        <Card className="card-section" static>
          <div className="card-section-title">Performance</div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={mockPortfolioHistory} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
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
        </Card>
      </div>

      {/* Dividends */}
      <Card className="card-section" static>
        <div className="card-section-title">Dividends</div>
        {dividends.map((d) => (
          <div className="list-row" key={d.id}>
            <span className="badge">{d.holding}</span>
            <span className="list-row-title text-green">{currency(d.amount, { cents: true })}</span>
            <span className="list-row-meta">{d.yield != null ? `${d.yield}% yield` : ''}</span>
            <span className="list-row-meta">{d.paid_date}</span>
          </div>
        ))}
      </Card>

      {addHolding && (
        <Modal
          title="Add Holding"
          onClose={() => setAddHolding(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddHolding(null)}>Cancel</button><button className="btn btn--accent" onClick={saveHolding}>Save</button></>}
        >
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Ticker</label><input className="input" value={addHolding.ticker || ''} onChange={(e) => setAddHolding({ ...addHolding, ticker: e.target.value })} autoFocus /></div>
            <div className="field"><label className="field-label">Asset Class</label><select className="select" value={addHolding.asset_class} onChange={(e) => setAddHolding({ ...addHolding, asset_class: e.target.value })}>{ASSET_CLASSES.map((a) => <option key={a}>{a}</option>)}</select></div>
          </div>
          <div className="field"><label className="field-label">Name</label><input className="input" value={addHolding.name || ''} onChange={(e) => setAddHolding({ ...addHolding, name: e.target.value })} /></div>
          <div className="grid grid-3">
            <div className="field"><label className="field-label">Shares</label><input className="input" type="number" value={addHolding.shares || ''} onChange={(e) => setAddHolding({ ...addHolding, shares: e.target.value })} /></div>
            <div className="field"><label className="field-label">Avg Cost</label><input className="input" type="number" value={addHolding.avg_cost || ''} onChange={(e) => setAddHolding({ ...addHolding, avg_cost: e.target.value })} /></div>
            <div className="field"><label className="field-label">Manual Price</label><input className="input" type="number" value={addHolding.manual_price || ''} onChange={(e) => setAddHolding({ ...addHolding, manual_price: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {addDiv && (
        <Modal
          title="Add Dividend"
          onClose={() => setAddDiv(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setAddDiv(null)}>Cancel</button><button className="btn btn--accent" onClick={saveDividend}>Save</button></>}
        >
          <div className="field"><label className="field-label">Holding</label><select className="select" value={addDiv.holding} onChange={(e) => setAddDiv({ ...addDiv, holding: e.target.value })}>{holdings.map((h) => <option key={h.id} value={h.ticker}>{h.ticker}</option>)}</select></div>
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Amount ($)</label><input className="input" type="number" value={addDiv.amount || ''} onChange={(e) => setAddDiv({ ...addDiv, amount: e.target.value })} autoFocus /></div>
            <div className="field"><label className="field-label">Paid Date</label><input className="input" type="date" value={addDiv.paid_date} onChange={(e) => setAddDiv({ ...addDiv, paid_date: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
