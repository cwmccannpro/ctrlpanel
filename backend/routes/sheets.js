// ============================================================
// Google Sheets-backed CRM (Express dev). The Worker (worker/index.js) calls the
// same dispatcher, so the two route tables cannot drift apart.
//
// Auth is a server-side service account (no user OAuth), so these routes only
// need a signed-in CTRLpanel user — the spreadsheet itself must be shared with
// the service account address, which /status returns for the UI to display.
// ============================================================
import { Router } from 'express';
import { verifyUser } from '../google.js';
import { getSheetsStatus, handleSheetsRequest } from '../sheets.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json(getSheetsStatus());
});

router.use(async (req, res, next) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  next();
});

router.all('/:action', async (req, res) => {
  const result = await handleSheetsRequest(req.method, req.params.action, req.query, req.body || {});
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.status(result.status).json(result.json);
});

export default router;
