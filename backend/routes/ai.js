import { Router } from 'express';
import { streamChat, supplementAnalyze, interactionCheck } from '../claude.js';

const router = Router();

// Streaming Master Controller chat (newline-delimited JSON).
router.post('/chat', (req, res) => streamChat(res, req.body || {}));

// AI Stack Evaluator (Supplements module).
router.post('/supplement-analyze', async (req, res) => {
  try {
    res.json(await supplementAnalyze(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick Interaction Checker (Supplements module).
router.post('/interaction-check', async (req, res) => {
  try {
    res.json(await interactionCheck(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
