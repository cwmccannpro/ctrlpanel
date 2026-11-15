import { Router } from 'express';
import { handleNutritionRequest } from '../nutritionApi.js';

const router = Router();
router.use(async (req, res) => {
  try {
    const url = new URL(req.originalUrl, process.env.FRONTEND_URL || 'http://localhost:5173');
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await handleNutritionRequest(req.method, url, headers, req.body));
  } catch (e) { res.status(e.status || 400).json({ error: e.message || 'Nutrition request failed.' }); }
});
export default router;
