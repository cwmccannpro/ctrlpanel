import { Router } from 'express';
import { getPrices } from '../finance.js';

const router = Router();

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

export default router;
