import { Router } from 'express';
import { listEvents, createEvent } from '../calendar.js';

const router = Router();

// GET /api/calendar/events
router.get('/events', async (req, res) => {
  try {
    res.json(await listEvents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/events
router.post('/events', async (req, res) => {
  try {
    res.json(await createEvent(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
