// ============================================================
// CTRLpanel — price + history data for the Investing module.
//
// Source: Yahoo Finance's public chart API (query1/query2 finance.yahoo.com)
// — the same data `yfinance` wraps. Plain fetch only, so it runs in both the
// Express dev server and the Cloudflare Worker. No API key required.
//   • getPrices(tickers)              → live quote { price, change% } per ticker
//   • getHistory(ticker, scale)       → one symbol's OHLC time series (for a
//                                       per-holding detail chart)
//   • getPortfolioHistory(holdings)   → the portfolio's value over time,
//                                       reconstructed from each holding's real
//                                       historical prices × current shares
// Crypto tickers (BTC, ETH, …) map to Yahoo's `<SYM>-USD` symbols.
// ============================================================

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// Tickers Yahoo quotes as `<SYM>-USD`.
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'XRP', 'AVAX', 'MATIC', 'DOT', 'LINK', 'LTC', 'BCH', 'UNI', 'ATOM', 'USDT', 'USDC']);

function toYahoo(ticker) {
  const t = String(ticker || '').toUpperCase().trim();
  if (!t) return t;
  if (t.includes('-')) return t; // already a Yahoo pair (e.g. BTC-USD)
  return CRYPTO.has(t) ? `${t}-USD` : t;
}

// UI time-scale → Yahoo (range, interval). Daily scales align cleanly across
// symbols for the portfolio sum; 1D/1W are intraday (per-symbol detail only).
const SCALE_MAP = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
  ALL: { range: 'max', interval: '1mo' },
};

// Fetch one symbol's chart. Falls back from query1 to query2 on failure.
async function fetchChart(ticker, range, interval) {
  const symbol = toYahoo(ticker);
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  let data = null;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetch(`https://${host}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) continue;
      data = await res.json();
      if (data?.chart?.result?.[0]) break;
    } catch {
      /* try next host */
    }
  }
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(data?.chart?.error?.description || `No data for ${symbol}`);

  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const c = adj && adj[i] != null ? adj[i] : closes[i];
    if (c == null) continue;
    series.push({ t: ts[i] * 1000, close: Number(c) });
  }
  return {
    ticker: String(ticker).toUpperCase(),
    symbol,
    currency: meta.currency || 'USD',
    meta: {
      price: meta.regularMarketPrice ?? series.at(-1)?.close ?? null,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      name: meta.shortName || meta.longName || null,
    },
    series,
  };
}

/** Live quotes: { [TICKER]: { price, change } }. Failed tickers are omitted. */
export async function getPrices(tickers = []) {
  const upper = [...new Set(tickers.map((t) => String(t).toUpperCase()).filter(Boolean))];
  const out = {};
  await Promise.all(
    upper.map(async (t) => {
      try {
        const c = await fetchChart(t, '1d', '1d');
        const price = c.meta.price;
        const prev = c.meta.prevClose;
        if (price == null) return;
        const change = price != null && prev ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0;
        out[t] = { price: Number(price), change };
      } catch {
        /* omit — the UI falls back to the holding's manual/avg price */
      }
    })
  );
  return out;
}

/** One symbol's history for a detail chart. */
export async function getHistory(ticker, scale = '1M') {
  const { range, interval } = SCALE_MAP[scale] || SCALE_MAP['1M'];
  const c = await fetchChart(ticker, range, interval);
  const first = c.series[0]?.close ?? null;
  const last = c.series.at(-1)?.close ?? c.meta.price;
  return {
    ticker: c.ticker,
    name: c.meta.name,
    currency: c.currency,
    price: c.meta.price,
    prevClose: c.meta.prevClose,
    periodStart: first,
    periodEnd: last,
    series: c.series,
  };
}

/**
 * Reconstruct the portfolio's value over time from each holding's real
 * historical prices × its current share count. Assumes today's shares held
 * across the whole window (a "what this portfolio was worth" curve).
 */
export async function getPortfolioHistory(holdings = [], scale = '6M') {
  const { range, interval } = SCALE_MAP[scale] || SCALE_MAP['6M'];
  const valid = holdings.filter((h) => h.ticker && Number(h.shares) > 0);
  if (!valid.length) return { scale, series: [] };

  const results = await Promise.all(
    valid.map(async (h) => {
      try {
        const c = await fetchChart(h.ticker, range, interval);
        return { shares: Number(h.shares), points: c.series };
      } catch {
        return null;
      }
    })
  );

  // Union of all timestamps, ascending.
  const tset = new Set();
  results.forEach((r) => r?.points.forEach((p) => tset.add(p.t)));
  const times = [...tset].sort((a, b) => a - b);
  if (!times.length) return { scale, series: [] };

  const series = times.map((t) => ({ t, value: 0 }));
  for (const r of results) {
    if (!r) continue;
    const byT = new Map(r.points.map((p) => [p.t, p.close]));
    let last = null;
    for (let i = 0; i < times.length; i++) {
      const c = byT.get(times[i]);
      if (c != null) last = c;
      if (last != null) series[i].value += last * r.shares;
    }
  }
  // Round for cleanliness.
  series.forEach((p) => (p.value = Number(p.value.toFixed(2))));
  return { scale, series };
}
