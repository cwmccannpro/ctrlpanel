import { Router } from 'express';
import { handleSocialRequest } from '../socials.js';

// Preserve the shared dispatcher's headers (especially HttpOnly OAuth cookies).
const router = Router();
router.use(async (req, res) => {
  try {
    const headers = new Headers();
    for (const key of ['authorization', 'cookie', 'content-type']) if (req.headers[key]) headers.set(key, req.headers[key]);
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: req.method, headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: JSON.stringify(req.body || {}) }),
    });
    const result = await handleSocialRequest(request);
    result.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(result.status).send(await result.text());
  } catch { res.status(500).json({ error: 'Could not reach the social integration. Try again.' }); }
});
export default router;
