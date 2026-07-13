import { Router } from 'express';
import { verifyUser } from '../google.js';
import {
  gmailReady,
  gmailAuthUrl,
  signGmailState,
  verifyGmailState,
  exchangeGmailCode,
  listGmailAccounts,
  disconnectGmailAccount,
  runTriage,
  createDraftForItem,
} from '../gmail.js';

const router = Router();
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

// Connected accounts for the current user (alias + email only — never tokens)
router.get('/status', async (req, res) => {
  const ready = gmailReady();
  const user = await verifyUser(req);
  if (!user) return res.json({ ready, accounts: [] });
  try {
    res.json({ ready, accounts: await listGmailAccounts(user.id) });
  } catch (e) {
    res.json({ ready, accounts: [], error: e.message });
  }
});

// Start OAuth for one alias — redirect the browser to Google's consent screen
router.get('/connect', async (req, res) => {
  if (!gmailReady()) return res.status(500).send('Gmail triage is not configured on the server (.env).');
  const user = await verifyUser(req);
  if (!user) return res.status(401).send('Not authenticated.');
  const alias = String(req.query.alias || '').trim().toLowerCase().slice(0, 24);
  if (!alias) return res.status(400).send('An account alias is required.');
  res.redirect(gmailAuthUrl(signGmailState(user.id, alias)));
});

// OAuth callback — exchange code for tokens, store per account, return to app
router.get('/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const { userId, alias } = verifyGmailState(req.query.state);
    await exchangeGmailCode(userId, alias, req.query.code);
    res.redirect(`${FRONTEND}/settings?gmail=connected&alias=${encodeURIComponent(alias)}`);
  } catch (e) {
    res.redirect(`${FRONTEND}/settings?gmail=error&message=${encodeURIComponent(e.message)}`);
  }
});

router.post('/disconnect', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await disconnectGmailAccount(user.id, req.body?.account_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// "Run now" — triage every connected account and persist one brief
router.post('/run', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await runTriage(user.id, 'manual'));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Approve a suggested reply → create a native Gmail draft (never sends)
router.post('/draft', async (req, res) => {
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await createDraftForItem(user.id, req.body?.item_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
