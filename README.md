# CTRLpanel

A multi-user personal **Life OS** — tasks, projects, CRM, calendar, health,
finances, habits, and an AI "Master Controller" — in one dark, glass-morphism
dashboard. Every user registers their own account and gets a fully isolated,
empty workspace.

**Stack:** React 18 + Vite · Supabase (email auth + Postgres with Row-Level
Security) · Express (local dev API) · **Cloudflare Worker** (production API +
static hosting) · Anthropic Claude (`claude-sonnet-4-6`) · Google Calendar
REST OAuth · Recharts · @dnd-kit · Excalidraw.

## Features

- **Dashboard** — customizable widget board: drag to rearrange, corner-drag to
  resize, add/remove from a 15-widget registry (stats, calendar views,
  priorities, habits, macros, Life View…). Layout saved per user.
- **Master Controller** — streaming Claude chat with real read/write tools over
  your own data (create tasks/events, log expenses, query anything), plus voice
  input. Per-user API keys supported via Settings → Connectors.
- **Calendar** — iCal-style time grid (Week/Day) + Month; **two-way Google
  Calendar sync** across all of a user's calendars, colors mapped to the app
  palette; local calendar fallback without Google.
- **Projects** — each project gets its own page: Charter + live roll-up
  dashboard, embedded **Excalidraw** canvas (auto-saved with thumbnail),
  Kanban board, pinnable markdown notes, files & links, linked CRM people.
- **To Do** — multiple boards with fully custom columns (rename/reorder/delete)
  and drag-and-drop cards.
- **CRM** — multiple CRM pages with per-page **custom columns**, inline editing,
  search/sort, CSV import, bulk actions; linkable to projects.
- **Health & Finance** — nutrition macros/goals, supplements with AI stack
  analysis, workouts with a 52-week heatmap, habits with streaks, net worth,
  budget, and an investing portfolio with live prices (CoinGecko + optional
  Alpha Vantage).
- **Reports** — inbound PDF reports. Create a named "report source" to get a
  private endpoint + token, then have any tool (e.g. a Claude routine that
  triages your email) POST a PDF to it; reports collect in-app to view,
  download, or delete. PDFs live in a private Supabase Storage bucket.

## Quick start

```bash
cp .env.example .env   # fill in Supabase / Anthropic / Google values
npm install
npm run server         # API  → http://localhost:3001
npm run dev            # app  → http://localhost:5173
```

Full setup (Supabase schema, Google OAuth, Cloudflare deploy):
see **[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)**.
Deploy is one command once secrets are set: `npm run deploy`.

## Repo map

```
src/               React app (pages, components, lib)
backend/           API modules + Express dev server (Worker-compatible code)
worker/index.js    Cloudflare Worker — production /api + serves ./dist
supabase-schema.sql  Idempotent schema: run in Supabase SQL Editor (source of truth)
wrangler.jsonc     Cloudflare config (assets + run_worker_first /api/*)
AGENTS.md          Ground-truth context for AI coding agents
```

## Security model

- Postgres **RLS** on every table (`user_id default auth.uid()` + "own rows"
  policies) — the browser only ever holds the anon key.
- `google_tokens` has RLS enabled with **no** policy: OAuth tokens are readable
  only by the backend via `SUPABASE_SERVICE_ROLE_KEY` and never reach the client.
- Secrets live in `.env` (gitignored) locally and Wrangler secrets in production.
