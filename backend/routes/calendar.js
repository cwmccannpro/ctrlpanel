import { Router } from 'express';
import {
  backendReady,
  authUrl,
  signState,
  verifyState,
  verifyUser,
  exchangeCode,
  getStatus,
  disconnect,
  listEvents,
  listCalendars,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../google.js';

const router = Router();
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

// Connection status for the current user
router.get('/status', async (req, res) => {
  const ready = backendReady();
  const user = await verifyUser(req);
  if (!user) return res.json({ connected: false, ready });
  try {
    res.json({ ...(await getStatus(user.id)), ready });
  } catch (e) {
    res.json({ connected: false, ready, error: e.message });
  }
});

// Start OAuth — redirect the browser to Google's consent screen
router.get('/connect', async (req, res) => {
  if (!backendReady()) return res.status(500).send('Google Calendar is not configured on the server (.env).');
  const user = await verifyUser(req);
  if (!user) return res.status(401).send('Not authenticated.');
  res.redirect(authUrl(signState(user.id)));
});

// OAuth callback — exchange code for tokens, store per-user, return to app
router.get('/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const userId = verifyState(req.query.state);
    await exchangeCode(userId, req.query.code);
    res.redirect(`${FRONTEND}/calendar?google=connected`);
  } catch (e) {
    res.redirect(`${FRONTEND}/calendar?google=error&message=${encodeURIComponent(e.message)}`);
  }
});

router.post('/disconnect', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await disconnect(user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The user's calendars (for the picker + legend)
router.get('/calendars', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await listCalendars(user.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Event CRUD (across the user's Google calendars) ----
router.get('/events', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await listEvents(user.id, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/events', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const body = req.body || {};
    res.json(await createEvent(user.id, body, body.cal_id || 'primary'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/events/:id', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const calId = req.query.calendarId || req.body?.cal_id || 'primary';
    res.json(await updateEvent(user.id, req.params.id, req.body || {}, calId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/events/:id', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await deleteEvent(user.id, req.params.id, req.query.calendarId || 'primary'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
