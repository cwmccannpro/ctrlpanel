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
    ts: Date.now(),
  });
});

app.use('/api/ai', aiRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/finance', financeRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CTRLpanel backend running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠ ANTHROPIC_API_KEY not set — Master Controller chat will return an error until it is added to .env');
  }
});
