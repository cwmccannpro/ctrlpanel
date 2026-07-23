// ============================================================
// Inbound PDF report ingestion (Express dev). The same surface exists in
// worker/index.js; the logic lives in backend/reports.js.
// Auth: per-source API token (Reports → Add report source), NOT a session.
// The PDF is the raw request body (Content-Type: application/pdf).
// ============================================================
import { Router } from 'express';
import express from 'express';
import { reportKeyFromHeaders, reportSourceForKey, ingestReport } from '../reports.js';

const router = Router();

// Raw-body parser scoped to this route so the global express.json() (which only
// touches application/json) never interferes with the binary upload.
router.post(
  '/ingest',
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '25mb' }),
  async (req, res) => {
    try {
      const key = reportKeyFromHeaders((h) => req.headers[h] || '');
      const source = await reportSourceForKey(key);
      if (!source) return res.status(401).json({ error: 'Invalid or revoked report token.' });
      const title = req.headers['x-report-title'] || req.query.title;
      res.json(await ingestReport(source, req.body, { title }));
    } catch (e) {
      res.status(400).json({ error: e?.message || 'Request failed' });
    }
  }
);

export default router;
