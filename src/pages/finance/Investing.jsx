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
import Spinner from '../../components/shared/Spinner.jsx';
import { useCrud } from '../../lib/useData.js';
import { finance } from '../../lib/api.js';
import { ASSET_CLASSES } from '../../lib/mockData.js';
import { currency, compactCurrency, percent, formatDate } from '../../lib/helpers.js';

const PIE_COLORS = ['#e11d48', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];
const GREEN = '#10b981';
const RED = '#ef4444';

const PERF_SCALES = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
const DETAIL_SCALES = ['1D', '1W', '1M', '6M', '1Y', 'ALL'];

const chartTooltip = { background: '#1a1414', border: '0.5px solid #2a2020', borderRadius: 8, fontSize: 12 };

const fmtTick = (t, scale) => {
  const d = new Date(t);
  if (scale === '1D' || scale === '1W') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (scale === '1Y' || scale === 'ALL') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtFull = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function ScaleBar({ scales, value, onChange }) {
  return (
    <div className="segmented">
      {scales.map((s) => (
        <button key={s} className={value === s ? 'active' : ''} onClick={() => onChange(s)}>{s}</button>
      ))}
    </div>
  );
}

// ---- Per-holding detail modal: live stats + historical price chart ----
function HoldingDetail({ holding, quote, onClose }) {
  const [scale, setScale] = useState('1M');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    finance
      .history(holding.ticker, scale)
      .then((d) => { if (active) { setData(d); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Chart unavailable'); setLoading(false); } });
    return () => { active = false; };
  }, [holding.ticker, scale]);

  const price = quote?.price ?? data?.price ?? holding.manual_price ?? holding.avg_cost ?? 0;
  const dayChange = quote?.change ?? 0;
  const shares = Number(holding.shares || 0);
  const value = shares * price;
  const cost = shares * Number(holding.avg_cost || 0);
  const gain = value - cost;
  const gainPct = cost ? (gain / cost) * 100 : 0;
  const up = (data ? data.periodEnd - data.periodStart : dayChange) >= 0;
  const color = up ? GREEN : RED;
  const series = data?.series || [];

  return (
    <Modal title={`${holding.ticker}${data?.name ? ` · ${data.name}` : ''}`} onClose={onClose} wide>
      <div className="invest-detail-stats">
        <div><span className="section-label">Price</span><div className="value-md">{currency(price, { cents: true })}</div></div>
        <div><span className="section-label">Today</span><div className={`value-md ${dayChange >= 0 ? 'text-green' : 'text-red'}`}>{dayChange >= 0 ? '+' : ''}{percent(dayChange)}</div></div>
        <div><span className="section-label">Shares</span><div className="value-md">{shares}</div></div>
        <div><span className="section-label">Position</span><div className="value-md">{currency(value)}</div></div>
        <div><span className="section-label">Total Gain</span><div className={`value-md ${gain >= 0 ? 'text-green' : 'text-red'}`}>{currency(gain)} · {percent(gainPct)}</div></div>
      </div>

      <div className="spread" style={{ margin: '4px 0 10px' }}>
        <span className="section-label">Price history</span>
        <ScaleBar scales={DETAIL_SCALES} value={scale} onChange={setScale} />
      </div>

      {loading ? (
        <div className="placeholder" style={{ minHeight: 240 }}><Spinner /></div>
      ) : error ? (
        <p className="body-text" style={{ minHeight: 60 }}>Chart unavailable: {error}</p>
      ) : series.length === 0 ? (
        <p className="body-text">No price data for this range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
            <defs>
              <linearGradient id="detailGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e1818" vertical={false} />
            <XAxis dataKey="t" stroke="#8a7070" fontSize={11} tickFormatter={(t) => fmtTick(t, scale)} minTickGap={40} />
            <YAxis stroke="#8a7070" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => compactCurrency(v)} width={54} />
            <Tooltip contentStyle={chartTooltip} labelFormatter={fmtFull} formatter={(v) => [currency(v, { cents: true }), 'Price']} />
            <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#detailGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Modal>
  );
}

export default function Investing() {
  const holdings = useCrud('holdings');
  const dividends = useCrud('dividends');
  const [prices, setPrices] = useState({});
  const [live, setLive] = useState(false);
  const [allocBy, setAllocBy] = useState('class');
  const [editHolding, setEditHolding] = useState(null);
  const [addDiv, setAddDiv] = useState(null);
  const [detail, setDetail] = useState(null);

  const [perfScale, setPerfScale] = useState('6M');
  const [perf, setPerf] = useState([]);
  const [perfLoading, setPerfLoading] = useState(false);

  const tickers = useMemo(() => holdings.rows.map((h) => h.ticker).filter(Boolean), [holdings.rows]);
  const tickerKey = tickers.join(',');

  // ---- Live quotes (poll every 10s) ----
  useEffect(() => {
    if (tickers.length === 0) { setLive(false); return; }
    let active = true;
    const poll = async () => {
      try {
        const data = await finance.prices(tickers);
        if (active) { setPrices(data); setLive(Object.keys(data).length > 0); }
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
    const quote = prices[h.ticker];
    const price = quote?.price ?? h.manual_price ?? h.avg_cost ?? 0;
    const dayChange = quote?.change ?? 0;
    const value = Number(h.shares || 0) * price;
    const cost = Number(h.shares || 0) * Number(h.avg_cost || 0);
    const gain = value - cost;
    const gainPct = cost ? (gain / cost) * 100 : 0;
    return { ...h, price, value, gain, gainPct, dayChange };
  });

  const totalValue = enriched.reduce((s, h) => s + h.value, 0);
  const totalGain = enriched.reduce((s, h) => s + h.gain, 0);
  const totalCost = totalValue - totalGain;
  const prevValue = enriched.reduce((s, h) => {
    const dc = Number(h.dayChange) || 0;
    const prev = dc ? h.value / (1 + dc / 100) : h.value;
    return s + (Number.isFinite(prev) ? prev : h.value);
  }, 0);
  const dayGain = totalValue - prevValue;
  const dayPct = prevValue ? (dayGain / prevValue) * 100 : 0;

  // ---- Portfolio performance history (reconstructed from real prices) ----
  const posKey = enriched.filter((h) => h.ticker && Number(h.shares) > 0).map((h) => `${h.ticker}:${h.shares}`).join(',');
  useEffect(() => {
    const list = holdings.rows
      .filter((h) => h.ticker && Number(h.shares) > 0)
      .map((h) => ({ ticker: h.ticker, shares: Number(h.shares) }));
    if (!list.length) { setPerf([]); return; }
    let active = true;
    setPerfLoading(true);
    finance
      .portfolioHistory(list, perfScale)
      .then((d) => { if (active) setPerf(d.series || []); })
      .catch(() => { if (active) setPerf([]); })
      .finally(() => { if (active) setPerfLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, perfScale]);

  const perfStart = perf[0]?.value ?? 0;
  const perfEnd = perf.at(-1)?.value ?? 0;
  const perfChange = perfEnd - perfStart;
  const perfPct = perfStart ? (perfChange / perfStart) * 100 : 0;
  const perfUp = perfChange >= 0;
  const perfColor = perfUp ? GREEN : RED;

  const allocData =
    allocBy === 'class'
      ? Object.entries(enriched.reduce((acc, h) => { acc[h.asset_class] = (acc[h.asset_class] || 0) + h.value; return acc; }, {})).map(([name, value]) => ({ name, value }))
      : enriched.map((h) => ({ name: h.ticker, value: h.value }));

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
            {live ? 'Live market prices · refreshes every 10s' : tickers.length ? 'Fetching live prices…' : 'Add a holding to track live value'}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setAddDiv({ holding_id: holdings.rows[0]?.id, paid_date: new Date().toISOString().slice(0, 10) })}><i className="ti ti-plus" /> Dividend</button>
          <button className="btn btn--accent" onClick={() => setEditHolding({ asset_class: 'Stocks' })}><i className="ti ti-plus" /> Add Holding</button>
        </div>
      </div>

      {/* Portfolio value stat cards */}
      <div className="grid grid-3">
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Portfolio Value</span><i className="ti ti-chart-pie" /></div>
          <div className="stat-card-value">{currency(totalValue)}</div>
          <div className={`list-row-meta ${dayGain >= 0 ? 'text-green' : 'text-red'}`}>{dayGain >= 0 ? '▲' : '▼'} {currency(Math.abs(dayGain))} ({percent(dayPct)}) today</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Total Gain/Loss</span><i className="ti ti-trending-up" /></div>
          <div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{currency(totalGain)}</div>
          <div className="list-row-meta">on {currency(totalCost)} cost basis</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-card-head"><span className="section-label">Total Return</span><i className="ti ti-percentage" /></div>
          <div className={`stat-card-value ${totalGain >= 0 ? 'text-green' : 'text-red'}`}>{percent(totalCost ? (totalGain / totalCost) * 100 : 0)}</div>
          <div className="list-row-meta">all-time</div>
        </Card>
      </div>

      {/* Big performance graph */}
      <Card className="card-section" static>
        <div className="card-section-title">
          <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
            <span>Performance</span>
            {perf.length > 0 && (
              <span className={perfUp ? 'text-green' : 'text-red'} style={{ fontSize: 13 }}>
                {perfUp ? '+' : ''}{currency(perfChange)} ({percent(perfPct)}) · {perfScale}
              </span>
            )}
          </div>
          <ScaleBar scales={PERF_SCALES} value={perfScale} onChange={setPerfScale} />
        </div>
        {holdings.rows.length === 0 ? (
          <p className="body-text">Add holdings to chart your portfolio's real performance over time.</p>
        ) : perfLoading && perf.length === 0 ? (
          <div className="placeholder" style={{ minHeight: 280 }}><Spinner /></div>
        ) : perf.length === 0 ? (
          <p className="body-text">Couldn't load market history right now — live values above are still current. Try another range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={perf} margin={{ top: 8, right: 8, left: -2, bottom: 0 }}>
              <defs>
                <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={perfColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={perfColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e1818" vertical={false} />
              <XAxis dataKey="t" stroke="#8a7070" fontSize={11} tickFormatter={(t) => fmtTick(t, perfScale)} minTickGap={44} />
              <YAxis stroke="#8a7070" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => compactCurrency(v)} width={56} />
              <Tooltip contentStyle={chartTooltip} labelFormatter={fmtFull} formatter={(v) => [currency(v), 'Portfolio']} />
              <Area type="monotone" dataKey="value" stroke={perfColor} strokeWidth={2} fill="url(#perfGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Holdings + Allocation side by side */}
      <div className="invest-split">
        <Card className="card-section" static style={{ flex: '2 1 520px', minWidth: 0 }}>
          <div className="card-section-title"><span>Holdings</span><span className="list-row-meta">Click a row for detail</span></div>
          {holdings.rows.length === 0 ? (
            <p className="body-text">No holdings yet. Add one to track live value and allocation.</p>
          ) : (
            <div className="table-wrap" style={{ border: 'none' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {['Ticker', 'Price', 'Day', 'Shares', 'Value', 'Gain %', ''].map((h, i) => (
                      <th key={i} style={{ cursor: 'default' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((h) => (
                    <tr key={h.id} onClick={() => setDetail(h)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {h.ticker}
                        {h.name && <div className="list-row-meta" style={{ fontWeight: 400 }}>{h.name}</div>}
                      </td>
                      <td>{currency(h.price, { cents: true })}</td>
                      <td className={h.dayChange >= 0 ? 'text-green' : 'text-red'}>{h.dayChange >= 0 ? '+' : ''}{percent(h.dayChange)}</td>
                      <td>{h.shares}</td>
                      <td>{currency(h.value)}</td>
                      <td className={h.gain >= 0 ? 'text-green' : 'text-red'}>{h.gain >= 0 ? '+' : ''}{percent(h.gainPct)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
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

        <Card className="card-section" static style={{ flex: '1 1 300px', minWidth: 0 }}>
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
                <Tooltip contentStyle={chartTooltip} formatter={(v) => currency(v)} />
              </PieChart>
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

      {detail && <HoldingDetail holding={detail} quote={prices[detail.ticker]} onClose={() => setDetail(null)} />}

      {editHolding && (
        <Modal
          title={editHolding.id ? 'Edit Holding' : 'Add Holding'}
          onClose={() => setEditHolding(null)}
          footer={<><button className="btn btn--ghost" onClick={() => setEditHolding(null)}>Cancel</button><button className="btn btn--accent" onClick={saveHolding}>Save</button></>}
        >
          <div className="grid grid-2">
            <div className="field"><label className="field-label">Ticker</label><input className="input" value={editHolding.ticker || ''} onChange={(e) => setEditHolding({ ...editHolding, ticker: e.target.value })} placeholder="AAPL, BTC…" autoFocus /></div>
            <div className="field"><label className="field-label">Asset Class</label><select className="select" value={editHolding.asset_class} onChange={(e) => setEditHolding({ ...editHolding, asset_class: e.target.value })}>{ASSET_CLASSES.map((a) => <option key={a}>{a}</option>)}</select></div>
          </div>
          <div className="field"><label className="field-label">Name</label><input className="input" value={editHolding.name || ''} onChange={(e) => setEditHolding({ ...editHolding, name: e.target.value })} /></div>
          <div className="grid grid-3">
            <div className="field"><label className="field-label">Shares</label><input className="input" type="number" value={editHolding.shares ?? ''} onChange={(e) => setEditHolding({ ...editHolding, shares: e.target.value })} /></div>
            <div className="field"><label className="field-label">Avg Cost</label><input className="input" type="number" value={editHolding.avg_cost ?? ''} onChange={(e) => setEditHolding({ ...editHolding, avg_cost: e.target.value })} /></div>
            <div className="field"><label className="field-label">Manual Price</label><input className="input" type="number" value={editHolding.manual_price ?? ''} onChange={(e) => setEditHolding({ ...editHolding, manual_price: e.target.value })} placeholder="fallback only" /></div>
          </div>
          <p className="list-row-meta">Leave Manual Price blank to always use the live market price. It's only a fallback when a ticker can't be fetched.</p>
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
