// ============================================================
// Agents folder (Express dev). Same surface in worker/index.js; logic in
// backend/opportunities.js (run orchestration) and backend/claude.js
// (Claude calls). Both routes need a signed-in CTRLpanel user.
// ============================================================
import { Router } from 'express';
import { verifyUser } from '../google.js';
import { runOpportunitiesCore } from '../opportunities.js';
import { extractResumeProfile } from '../claude.js';

const router = Router();

// On-demand Opportunities run — NDJSON progress stream (see opportunities.js).
router.post('/opportunities/run', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const write = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };
  try {
    const { apiKey, today } = req.body || {};
    await runOpportunitiesCore({ userId: user.id, apiKey, today }, write);
  } finally {
    res.end();
  }
});

// Resume PDF (base64) → plain-text profile for the agent config.
router.post('/opportunities/profile', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await extractResumeProfile(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
