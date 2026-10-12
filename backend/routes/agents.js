// ============================================================
// Agents folder (Express dev). Same surface in worker/index.js; logic in
// backend/opportunities.js + backend/industry.js (run orchestration) and backend/claude.js
// (Claude calls). Both routes need a signed-in CTRLpanel user, and runs on the
// server's Anthropic key count against the per-user limits in backend/aiGuard.js.
// ============================================================
import { Router } from 'express';
import { verifyUser } from '../google.js';
import { runOpportunitiesCore } from '../opportunities.js';
import { runIndustryCore } from '../industry.js';
import { extractResumeProfile } from '../claude.js';
import { AI_ESTIMATE_USD, AiLimitError, aiErrorBody, reserveAgentRun, withAiLease } from '../aiGuard.js';

const router = Router();

// Reserve spend, then stream the run as NDJSON; the run's reported cost settles the lease.
async function streamRun(req, res, user, run) {
  let lease;
  try {
    lease = await reserveAgentRun({ user, apiKey: req.body?.apiKey });
  } catch (e) {
    if (!(e instanceof AiLimitError)) throw e;
    if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
    return res.status(e.status).json(aiErrorBody(e));
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const write = lease.wrap((obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  });
  try {
    await run(write);
  } finally {
    await lease.settle();
    res.end();
  }
}

// On-demand Opportunities run — NDJSON progress stream (see opportunities.js).
router.post('/opportunities/run', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { apiKey, today } = req.body || {};
  await streamRun(req, res, user, (write) => runOpportunitiesCore({ userId: user.id, apiKey, today }, write));
});

// On-demand Industry Problems run for one industry — NDJSON progress stream (see industry.js).
router.post('/industry/run', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { apiKey, today, industry, focus } = req.body || {};
  await streamRun(req, res, user, (write) => runIndustryCore({ userId: user.id, apiKey, today, industry, focus }, write));
});

// Resume PDF (base64) → plain-text profile for the agent config.
router.post('/opportunities/profile', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await withAiLease({ user, apiKey: req.body?.apiKey, estimateUsd: AI_ESTIMATE_USD.resume }, () => extractResumeProfile(req.body || {})));
  } catch (e) {
    if (e instanceof AiLimitError) {
      if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
      return res.status(e.status).json(aiErrorBody(e));
    }
    res.status(400).json({ error: e.message });
  }
});

export default router;
