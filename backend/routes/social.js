// ============================================================
// Sharing + social routes (Express dev). Same surface exists in
// worker/index.js; the logic lives in backend/social.js.
// Auth: Supabase access token (Authorization: Bearer).
// ============================================================
import { Router } from 'express';
import { verifyUser } from '../google.js';
import {
  createBoardShare,
  acceptInvite,
  createFriendInvite,
  getFriends,
  removeFriend,
  getLeaderboard,
  createChallenge,
  listChallenges,
  respondChallenge,
  deleteChallenge,
} from '../social.js';

const router = Router();
const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// Wrap a handler with auth + uniform error responses.
const authed = (fn) => async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await fn(user, req));
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Request failed' });
  }
};

/* ---- Shared to-do lists ---- */
router.post('/shares/board', authed((user, req) => createBoardShare(user, req.body || {}, APP_URL())));

/* ---- Universal invite accept (board share or friend request) ---- */
router.post('/invites/accept', authed((user, req) => acceptInvite(user, req.body?.token)));

/* ---- Nutrition friends ---- */
router.get('/social/friends', authed((user) => getFriends(user)));
router.post('/social/friends', authed((user, req) => createFriendInvite(user, req.body || {}, APP_URL())));
router.delete('/social/friends/:id', authed((user, req) => removeFriend(user, req.params.id)));

/* ---- Leaderboard (aggregates only) ---- */
router.get('/social/leaderboard', authed((user, req) => getLeaderboard(user, req.query)));

/* ---- Challenges ---- */
router.get('/social/challenges', authed((user) => listChallenges(user)));
router.post('/social/challenges', authed((user, req) => createChallenge(user, req.body || {})));
router.post('/social/challenges/:id/respond', authed((user, req) => respondChallenge(user, req.params.id, Boolean(req.body?.accept))));
router.delete('/social/challenges/:id', authed((user, req) => deleteChallenge(user, req.params.id)));

export default router;
