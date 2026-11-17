import { Router } from 'express';
import { handleCaldavRequest } from '../caldav.js';

// Thin adapter: the iCloud CalDAV dispatcher in backend/caldav.js serves both
// Express and the Worker, so routes are added there, never here.
const router = Router();
router.all('/*', async (req, res) => {
  const request = new Request(new URL(req.originalUrl, 'http://localhost'), {
    method: req.method,
    headers: { authorization: req.get('authorization') || '', 'content-type': 'application/json' },
    ...(req.method === 'POST' ? { body: JSON.stringify(req.body || {}) } : {}),
  });
  const response = await handleCaldavRequest(request);
  res.status(response.status);
  response.headers.forEach((value, key) => res.set(key, value));
  res.send(await response.text());
});
export default router;
