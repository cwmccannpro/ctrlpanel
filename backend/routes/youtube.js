// ============================================================
// YouTube analytics (Express dev). Same surface in worker/index.js; logic in
// backend/youtube.js. Channel tokens are service-role only — the browser only
// ever sees channel metadata + analytics through these endpoints.
// ============================================================
import { Router } from 'express';
import { verifyUser } from '../google.js';
import {
  youtubeReady,
  youtubeAuthUrl,
  signYoutubeState,
  verifyYoutubeState,
  exchangeYoutubeCode,
  listYoutubeChannels,
  disconnectYoutubeChannel,
  getYoutubeAnalytics,
} from '../youtube.js';

const router = Router();
const frontend = () => process.env.FRONTEND_URL || 'http://localhost:5173';

router.get('/status', async (req, res) => {
  try {
    const ready = youtubeReady();
    const user = await verifyUser(req);
    if (!user) return res.json({ ready, channels: [] });
    res.json({ ready, channels: await listYoutubeChannels(user.id) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load YouTube status.' });
  }
});

router.get('/connect', async (req, res) => {
  if (!youtubeReady()) return res.status(500).send('YouTube is not configured on the server.');
  const user = await verifyUser(req);
  if (!user) return res.status(401).send('Not authenticated.');
  res.redirect(youtubeAuthUrl(signYoutubeState(user.id)));
});

router.get('/callback', async (req, res) => {
  const base = frontend();
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const userId = verifyYoutubeState(req.query.state);
    await exchangeYoutubeCode(userId, req.query.code);
    res.redirect(`${base}/socials/youtube?youtube=connected`);
  } catch (e) {
    res.redirect(`${base}/socials/youtube?youtube=error&message=${encodeURIComponent(e.message)}`);
  }
});

router.post('/disconnect', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await disconnectYoutubeChannel(user.id, req.body?.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/analytics', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await getYoutubeAnalytics(user.id, req.query.id, req.query.range || '28d'));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
