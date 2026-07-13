// ============================================================
// External nutrition logging (Express dev). Same surface exists in
// worker/index.js; the logic lives in backend/nutritionApi.js.
// Auth: per-user API key (Settings → Nutrition API), NOT a session.
// ============================================================
import { Router } from 'express';
import { userIdForApiKey, apiKeyFromHeaders, logNutritionEntry } from '../nutritionApi.js';

const router = Router();

router.post('/log', async (req, res) => {
  try {
    const key = apiKeyFromHeaders((h) => req.headers[h] || '');
    const userId = await userIdForApiKey(key);
    if (!userId) return res.status(401).json({ error: 'Invalid or revoked API key.' });
    res.json(await logNutritionEntry(userId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Request failed' });
  }
});

export default router;
