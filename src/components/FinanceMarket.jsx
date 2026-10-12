import { useEffect, useId, useState } from 'react';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { finance } from '../lib/api.js';
import { financeMoney, financeDay } from '../lib/financeSheet.js';

const SCALES = ['1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'];
export default function FinanceMarket({ holdings = [] }) {
  const [scale, setScale] = useState('1M');
  const [symbol, setSymbol] = useState('');
  const [prices, setPrices] = useState({});
  const [series, setSeries] = useState([]);
  const [unit, setUnit] = useState('USD');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const [quoteAt, setQuoteAt] = useState(null);
  const uid = useId().replace(/:/g, '');
  const positions = holdings.filter((h) => h.ticker && h.shares > 0).map((h) => ({ ...h, ticker: h.ticker.toUpperCase() }));
  const tickers = [...new Set(positions.map((h) => h.ticker.toUpperCase()))];
  const tickerKey = tickers.join(',');
  const positionKey = JSON.stringify(positions.map(({ ticker, shares }) => ({ ticker, shares })));
  useEffect(() => {
    if (!tickerKey) { setPrices({}); return; }
    let active = true;
    const poll = () => finance.prices(tickerKey.split(',')).then((p) => { if (active) { setPrices(p); setQuoteError(false); setQuoteAt(Date.now()); } }).catch(() => active && setQuoteError(true));
    poll(); const interval = setInterval(() => { if (document.visibilityState !== 'hidden') poll(); }, 10000);
    return () => { active = false; clearInterval(interval); };
  }, [tickerKey]);
  useEffect(() => {
    if (!positionKey || positionKey === '[]') { setSeries([]); return; }
    let active = true; setLoading(true); setError('');
    const current = JSON.parse(positionKey);
    const request = symbol && current.some((h) => h.ticker === symbol) ? finance.history(symbol, scale) : finance.portfolioHistory(current, scale);
    request.then((result) => {
      if (!active) return;
      setUnit(result.currency || 'USD');
      setSeries((result.series || []).map((p) => ({ date: financeDay(new Date(p.t * (p.t < 1e12 ? 1000 : 1))), value: p.value ?? p.close })));
      if (!(result.series || []).length) setError('Market history is unavailable for these tickers.');
    }).catch((e) => active && setError(e.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [positionKey, scale, symbol]);
  const format = (value) => unit === 'USD' ? financeMoney(value) : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`;
  return <section className="fin-section">
    <div className="fin-section-head"><div><h2>Market context</h2><p>{symbol ? 'Historical market price' : 'Your current positions at historical market prices'}</p></div>{positions.length > 0 && <label><span className="sr-only">Market chart holding</span><select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}><option value="">All positions</option>{tickers.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>}</div>
    {!positions.length ? <div className="fin-chart-empty"><i className="ti ti-chart-line" aria-hidden="true" /><strong>Add positions to see market history</strong><span>Tickers and shares from your Sheet power live quotes and historical charts.</span></div> : <>
      <div className="fin-market-quotes">{tickers.map((t) => <button key={t} onClick={() => setSymbol(t)} className="fin-market-quote"><span>{t}</span><strong>{prices[t] ? `${prices[t].price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${prices[t].currency || ''}` : 'Unavailable'}</strong>{prices[t] && <small className={prices[t].change >= 0 ? 'text-green' : 'text-red'}>{prices[t].change >= 0 ? '+' : ''}{prices[t].change}% vs prior close</small>}</button>)}</div>
      {quoteError && <p className="fin-caption" role="status">Quote refresh failed · showing last received prices.</p>}
      {quoteAt && <p className="fin-caption">Quotes read at {new Date(quoteAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
      <div className="fin-market-scales" aria-label="Market chart range">{SCALES.map((r) => <button key={r} className={r === scale ? 'active' : ''} aria-pressed={r === scale} onClick={() => setScale(r)}>{r}</button>)}</div>
      {loading ? <div className="fin-chart-empty" role="status">Loading market history…</div> : error ? <p className="fin-empty" role="status">{error}</p> : <ResponsiveContainer width="100%" height={260}><AreaChart data={series} margin={{ top: 12, right: 8, left: 4, bottom: 4 }}><defs><linearGradient id={`market-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" stroke="var(--text-secondary)" tickLine={false} axisLine={false} fontSize={10} minTickGap={30} /><YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} fontSize={10} width={78} tickFormatter={format} /><Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 8 }} formatter={(v) => [format(v), symbol || 'Positions']} /><Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill={`url(#market-${uid})`} isAnimationActive={false} /></AreaChart></ResponsiveContainer>}
      <p className="fin-caption">Quotes refresh every 10 seconds and do not overwrite your Sheet. The combined chart assumes today’s share counts across the selected period; it is a reconstruction, not a record of your historical returns.</p>
    </>}
  </section>;
}
