import { Router } from 'express';
import { getPrices, getHistory, getPortfolioHistory } from '../finance.js';
import { verifyUser } from '../google.js';
import { handleFinanceSheetsRequest } from '../financeSheets.js';

const router = Router();

router.all('/sheets/:action', async (req, res) => {
  const user = await verifyUser(req);
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const result = await handleFinanceSheetsRequest(req.method, req.params.action, { token, user, body: req.body || {} });
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.status(result.status).json(result.json);
});

// GET /api/finance/prices?tickers=AAPL,MSFT,BTC
router.get('/prices', async (req, res) => {
  const tickers = String(req.query.tickers || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  try {
    res.json(await getPrices(tickers));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finance/history?ticker=AAPL&scale=1M — one symbol's chart series
router.get('/history', async (req, res) => {
  try {
    const ticker = String(req.query.ticker || '').trim();
    if (!ticker) return res.status(400).json({ error: 'ticker is required' });
    res.json(await getHistory(ticker, String(req.query.scale || '1M')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/finance/portfolio-history { holdings:[{ticker,shares}], scale }
router.post('/portfolio-history', async (req, res) => {
  try {
    const { holdings = [], scale = '6M' } = req.body || {};
    res.json(await getPortfolioHistory(holdings, scale));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
