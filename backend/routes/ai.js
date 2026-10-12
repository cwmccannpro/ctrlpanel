import { Router } from 'express';
import { handleAiRequest } from '../ai.js';

// Same dispatcher as the Worker (backend/ai.js): auth, limits and validation
// live there. This only adapts Express <-> Request/Response, streaming included.
const router = Router();
router.use(async (req, res) => {
  try {
    const headers = new Headers();
    for (const key of ['authorization', 'content-type']) if (req.headers[key]) headers.set(key, req.headers[key]);
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: req.method, headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: JSON.stringify(req.body || {}) }),
    });
    const result = await handleAiRequest(request);
    if (!result) return res.status(404).json({ error: 'Not found' });
    result.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(result.status);
    if (!result.body) return res.end();
    res.flushHeaders?.();
    for await (const chunk of result.body) res.write(chunk);
    res.end();
  } catch {
    if (res.headersSent) res.end();
    else res.status(500).json({ error: 'AI request failed.' });
  }
});
export default router;
