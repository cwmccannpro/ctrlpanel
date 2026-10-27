import { Router } from 'express';
import { handleRoomRequest } from '../room.js';

const router = Router();
router.use(async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const result = await handleRoomRequest(req.method, req.path, token, req.body);
  res.status(result.status || 200).set('Cache-Control', 'no-store').json(result.body);
});
export default router;
