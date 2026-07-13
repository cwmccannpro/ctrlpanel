// ============================================================
// CTRLpanel — Express backend entry point (port 3001)
// Run from the project root: `npm run server`
// ============================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import aiRoutes from './routes/ai.js';
import calendarRoutes from './routes/calendar.js';
import financeRoutes from './routes/finance.js';
import socialRoutes from './routes/social.js';
import nutritionRoutes from './routes/nutrition.js';
import gmailRoutes from './routes/gmail.js';
import { runDueTriage, gmailReady } from './gmail.js';

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  })
);
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ctrlpanel-backend',
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    email: Boolean(process.env.RESEND_API_KEY),
    ts: Date.now(),
  });
});

app.use('/api/ai', aiRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api', socialRoutes); // /api/shares, /api/invites, /api/social
app.use('/api/nutrition', nutritionRoutes); // external API-key logging
app.use('/api/gmail', gmailRoutes); // Email Triage (multi-account Gmail)

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CTRLpanel backend running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠ ANTHROPIC_API_KEY not set — Master Controller chat will return an error until it is added to .env');
  }

  // Email Triage scheduler — every 15 min, run due jobs for users whose
  // Email Triage agent is toggled ON (production uses the Worker cron).
  if (gmailReady()) {
    const tick = () => runDueTriage().catch((e) => console.error('triage scheduler:', e.message));
    setTimeout(tick, 30 * 1000);
    setInterval(tick, 15 * 60 * 1000);
  }
});
