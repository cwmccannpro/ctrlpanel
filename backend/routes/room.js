import { Router } from 'express';
import { handleRoomRequest } from '../room.js';
const router = Router();
router.all('/*', async (req, res) => {
  const request = new Request(new URL(req.originalUrl, 'http://localhost'), {
    method: req.method,
    headers: { authorization: req.get('authorization') || '', 'content-type': 'application/json' },
    ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
  });
  const response = await handleRoomRequest(request);
  res.status(response.status);
  response.headers.forEach((value, key) => res.set(key, value));
  res.send(await response.text());
});
export default router;
