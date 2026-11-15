import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { getHistory, getPortfolioHistory, getPrices } from '../backend/finance.js';
const original = globalThis.fetch;
after(() => { globalThis.fetch = original; });
globalThis.fetch = async (url) => {
  const symbol = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  if (symbol === 'MISSING') return new Response('{}', { status: 502 });
  const prices = symbol === 'USD2' ? [20, 22] : [10, 11];
  return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: symbol === 'FOREIGN' ? 'EUR' : 'USD', regularMarketPrice: prices[1], previousClose: prices[0] }, timestamp: [1791244800, 1791331200], indicators: { quote: [{ close: prices }] } }] } }), { headers: { 'content-type': 'application/json' } });
};
test('market reconstruction sums current shares at real historical prices', async () => {
  const data = await getPortfolioHistory([{ ticker: 'USD1', shares: 2 }, { ticker: 'USD2', shares: 3 }], '1M');
  assert.deepEqual(data.series.map((p) => p.value), [80, 88]);
  assert.equal(data.series[0].t, 1791244800000);
});
test('combined chart refuses mixed currencies and missing histories instead of showing misleading totals', async () => {
  await assert.rejects(getPortfolioHistory([{ ticker: 'USD1', shares: 2 }, { ticker: 'FOREIGN', shares: 1 }]), /USD-priced/);
  await assert.rejects(getPortfolioHistory([{ ticker: 'USD1', shares: 2 }, { ticker: 'MISSING', shares: 1 }]), /unavailable for some/);
  assert.deepEqual((await getPortfolioHistory([])).series, []);
});
test('individual history and quotes preserve the quoted currency', async () => {
  assert.equal((await getHistory('FOREIGN')).currency, 'EUR');
  assert.deepEqual((await getPrices(['FOREIGN'])).FOREIGN, { price: 11, change: 10, currency: 'EUR' });
});
