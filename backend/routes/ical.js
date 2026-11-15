import { Router } from 'express';
import { verifyUser } from '../google.js';
import { icalEvents } from '../ical.js';

const router = Router();

// Read-only iCalendar feeds. POST (not GET) so the feed URL — which is the
// only secret an iCloud "public calendar" has — never lands in a query string
// or an access log.
router.post('/events', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await icalEvents(req.body || {}));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Feeds could not load.' });
  }
});

export default router;
