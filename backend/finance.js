// ============================================================
// CTRLpanel — price fetching for the Investing module.
// Crypto: CoinGecko (free, no key). Stocks/ETFs: Alpha Vantage if a
// key is provided, otherwise a deterministic mock so the UI always works.
// ============================================================

// Common crypto ticker → CoinGecko id
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  DOT: 'polkadot',
  LINK: 'chainlink',
};

// Deterministic pseudo-price so mock data is stable per ticker.
function mockPrice(ticker) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) % 100000;
  const base = 20 + (hash % 480); // $20–$500
  const change = ((hash % 800) / 100 - 4).toFixed(2); // -4% .. +4%
  return { price: Number(base.toFixed(2)), change: Number(change), mock: true };
}

async function fetchCrypto(tickers) {
  const ids = tickers.map((t) => COINGECKO_IDS[t]).filter(Boolean);
  if (ids.length === 0) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
    ','
  )}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const t of tickers) {
    const id = COINGECKO_IDS[t];
    if (id && data[id]) {
      out[t] = {
        price: data[id].usd,
        change: Number((data[id].usd_24h_change || 0).toFixed(2)),
      };
    }
  }
  return out;
}

async function fetchStock(ticker) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) return mockPrice(ticker);
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    const q = data['Global Quote'];
    if (q && q['05. price']) {
      return {
        price: Number(q['05. price']),
        change: Number(parseFloat(q['10. change percent']) || 0),
      };
    }
  } catch {
    /* fall through to mock */
  }
  return mockPrice(ticker);
}

/**
 * Returns { [ticker]: { price, change, mock? } } for the given tickers.
 * Crypto tickers route to CoinGecko; everything else is treated as a stock/ETF.
 */
export async function getPrices(tickers = []) {
  const upper = tickers.map((t) => t.toUpperCase());
  const cryptoTickers = upper.filter((t) => COINGECKO_IDS[t]);
  const stockTickers = upper.filter((t) => !COINGECKO_IDS[t]);

  const result = {};

  if (cryptoTickers.length) {
    try {
      Object.assign(result, await fetchCrypto(cryptoTickers));
    } catch {
      for (const t of cryptoTickers) result[t] = mockPrice(t);
    }
  }

  const stockResults = await Promise.all(stockTickers.map((t) => fetchStock(t)));
  stockTickers.forEach((t, i) => {
    result[t] = stockResults[i];
  });

  return result;
}
