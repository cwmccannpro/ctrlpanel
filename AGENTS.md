# CTRLpanel — Project Context for Agents

> Read this file at the start of EVERY session before writing code.
> **`supabase-schema.sql` is the single source of truth for the database.**
> This doc describes architecture and conventions; when in doubt about a
> column or table, read the schema file — do not trust memory or old docs.

## Identity
- App name: CTRLpanel · Tagline: by cwmccann.pro · Owner: Cameron McCann
- Purpose: **multi-user** Life OS. Every visitor can register and gets a
  fully isolated, empty workspace. Nothing is ever hardcoded to one person.
- Local dev: frontend http://localhost:5173 (Vite) + API http://localhost:3001 (Express)
- Production: Cloudflare Worker (API) + static assets, single deploy — see Deployment.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, plain CSS custom properties (NO Tailwind, NO component libs) |
| Auth + DB | Supabase (email auth; Postgres with Row-Level Security on every table) |
| Backend (local dev) | Node + Express (`backend/server.js`, port 3001; Vite proxies `/api`) |
| Backend (production) | Cloudflare Worker (`worker/index.js`) serving the same `/api` surface + `./dist` assets |
| AI | Anthropic Claude API — model `claude-sonnet-4-6` (valid, current alias for Claude Sonnet 4.6 — do not "fix" it) |
| Google Calendar | Two-way sync via plain REST OAuth (`backend/google.js`, no googleapis dependency — must stay Workers-compatible) |
| Icons / Charts / DnD / Canvas | Tabler webfont · Recharts · @dnd-kit · @excalidraw/excalidraw (lazy-loaded) |

## Architecture — the rules that keep this multi-user
1. **Auth gates everything.** `AuthProvider` (src/components) holds session/profile/
   settings; routes are wrapped in `RequireAuth`; signed-out users only see
   /login and /register. New accounts are provisioned empty by a DB trigger
   (`handle_new_user` → profiles + user_settings). **Never seed user data.**
2. **RLS does the isolation.** Every data table has `user_id default auth.uid()`
   and an "own rows" policy. The browser uses only the anon key; inserts never
   pass `user_id` explicitly.
3. **Two keys, two worlds.**
   - Frontend: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (safe, RLS-scoped).
   - Backend only: `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS. Used exclusively
     for `google_tokens` (which has RLS enabled with NO policy, so the browser
     can never read OAuth tokens) and for headless writers like the inbound PDF
     report ingester (`reports` rows + the `reports` storage bucket).
4. **All DB access goes through `src/lib`**: `supabase.js` (client + auth +
   CRUD + `queryTable`), `useData.js` (`useRows`, `useCrud` with optimistic
   updates). Components never import @supabase/supabase-js directly.
5. **All Claude calls go through the backend** (`backend/claude.js`). Per-user
   Anthropic keys from Settings → Connectors take precedence over the env key.
6. **Backend modules must run in BOTH runtimes** (Express dev + Cloudflare
   Worker prod). That means: plain `fetch` for HTTP, `node:crypto` only
   (nodejs_compat covers it), read `process.env` at call time, no Node-only
   packages (this is why googleapis was removed).

## Database (summary — schema file is authoritative)
- Identity: `profiles`, `user_settings` (accent, font, connectors jsonb,
  dashboard_widgets jsonb, birthdate/life_expectancy for Life View)
- Tasks: `boards` (per-user, `columns` jsonb = custom Kanban columns), `tasks`,
  `board_shares` (email invites → collaborators; boards/tasks have extra RLS
  policies via `can_access_board()` security-definer fn)
- Projects: `projects` (+ `charter` jsonb, `notes_list` jsonb, `files` jsonb
  [{title,url,type,added_at}], `service_links` jsonb [{id,label,url,icon,paid}]
  = per-project Services quick-links bar, `excalidraw` scene jsonb,
  `excalidraw_preview`, `crm_board_id` → linked CRM page)
- CRM: `crm_boards` (multiple CRM pages, `columns` jsonb = custom columns),
  `crm_contacts` (+ `board_id`, `custom` jsonb for custom-column values)
- Calendar: `calendar_events` (local fallback; Google is primary when connected),
  `google_tokens` (service-role only)
- Health: `nutrition_logs` (+ `notes`), `weight_logs`, `water_logs`,
  `user_goals` (+ `water`), `supplements`, `supplement_logs`,
  `fitness_schedule`, `workout_logs`
- Nutrition social: `nutrition_friends`, `nutrition_challenges`,
  `nutrition_challenge_members` (service-role only — read/written via
  `/api/social/*` so users only see friends' aggregates, never raw logs);
  `api_keys` (hashed per-user keys for the external logging endpoint)
- Habits: `habits`, `habit_logs` (unique habit_id+log_date)
- Finance: `accounts`, `net_worth_snapshots`, `income_sources`,
  `expense_categories`, `transactions`, `holdings`, `portfolio_snapshots`, `dividends`
- Reports (inbound PDFs): `report_sources` (named inbound channels, each with
  a hashed token `key_hash` — plaintext shown once in the UI), `reports` (one
  row per received PDF; `file_path` points into the private `reports` storage
  bucket). Rows are written by the backend on ingest with explicit user_id and
  read/deleted by the owner's client under "own rows" RLS. The PDF bytes live
  in Supabase Storage (bucket `reports`, private; storage RLS scopes objects to
  the owner's `{user_id}/…` folder — the client reads via signed URLs)
- **Schema changes**: append idempotent SQL (`create table if not exists`,
  `add column if not exists`) to `supabase-schema.sql` and add the table to the
  RLS loop. The whole file must always be safe to re-run.

## Feature Map (what exists — do not rebuild)
- **Dashboard**: customizable widget board — drag to reorder (@dnd-kit), corner-
  drag to resize (col/row spans, 6-col grid), Add Widget picker; layout saved to
  `user_settings.dashboard_widgets`. Widget registry: `src/components/dashboardWidgets.jsx`
  (stats, Calendar w/ Today|Week|Month views, priorities, habits, macros, Life View, …).
- **Calendar**: iCal-style time grid (Week/Day, 5 AM–midnight auto-fit, now-line,
  all-day row) + Month. Google two-way sync across ALL the user's calendars;
  calendar picker on events (colors follow calendar, hue-mapped to app palette);
  local Supabase fallback when not connected.
- **To Do**: multiple persisted boards; per-board custom columns (add/rename/
  reorder/delete); drag cards; cards auto-sort by priority within a column
  (Urgent→High→Medium→Low, stable within a tier); share a board by email
  (Resend invite → `/invite/:token` accept → full read/write for the
  collaborator, Realtime live sync, owner can revoke).
- **Projects**: list + per-project sub-pages (`/projects/:id`, dynamic sidebar
  items) with 6 tabs: Project Dashboard (per-project Services quick-links bar
  [add presets/custom, drag-reorder, "Paid" tags; `src/components/ServiceLinks.jsx`,
  saved to `projects.service_links`] + Charter + live roll-ups), Excalidraw
  (persisted scene + thumbnail), Board, Notes (pinnable, markdown), Files &
  Links, People (synced with linked CRM page).
- **CRM**: multiple pages (`/crm/:boardId`, in sidebar), custom columns per page,
  inline editing, search/sort/hide columns, CSV import, bulk delete.
- **Reports**: inbound PDF reports. Each "report source" (`/reports`, dynamic
  sidebar sub-pages `/reports/:sourceId`) is a named inbound channel with its
  own token; external tools POST a PDF to `/api/reports/ingest` and it lands as
  a report the user views/downloads/deletes in-app. Replaces the old Agents
  section. See the Reports feature note below.
- **Habits**: tracker (14-day toggle grid, streaks) + Life View (birthdate,
  weeks-of-life; feeds the Life View widget).
- **Nutrition social**: water logging (rings + goal), email friend invites
  (Resend, same `/invite/:token` flow), leaderboard (calorie/protein goal
  adherence %, water, logging streak over 7/30 days), time-boxed challenges
  with live standings + winner at end. UI in `src/pages/health/NutritionSocial.jsx`;
  aggregates computed server-side in `backend/social.js`.
- **Nutrition external API**: `POST /api/nutrition/log` authenticated by a
  per-user API key (Settings → Nutrition API; SHA-256 hash stored in
  `api_keys`). Entries land in `nutrition_logs` like manual ones.
- **Health / Finance**: full CRUD everywhere (inline edit + delete on every row);
  charts compute from real user data; Investing polls live prices every 10s
  (`/api/finance/prices`: CoinGecko free for crypto, Alpha Vantage optional for stocks).
- **Master Controller**: streaming chat (NDJSON over `/api/ai/chat`); frontend
  drives the agentic loop executing `query_records` / `create_record` /
  `update_record` / `delete_record` (+ `navigate_to`) via `src/lib/mcTools.js`
  against the RLS-scoped client; calendar tools route to Google when connected;
  delete requires in-app confirmation.
- **Settings**: profile, accent (8 swatches → CSS vars, per-user), font size,
  Connectors (Anthropic key, Alpha Vantage, custom) saved to `user_settings.connectors`;
  Nutrition API keys panel.
- **Reports (inbound PDFs)**: a way to accept a PDF report sent to CTRLpanel
  from whatever tool the user runs (e.g. a Claude routine doing email triage
  emits a PDF and POSTs it here). A "report source" is a named inbound channel
  with its own token (SHA-256 hashed in `report_sources.key_hash`, plaintext
  shown once on create — same pattern as the Nutrition API keys). External
  clients call `POST /api/reports/ingest` with `Authorization: Bearer ctpr_…`
  (or `X-API-Key`) and the raw PDF as the request body; optional
  `X-Report-Title` header sets the title. The backend (service role) validates
  the `%PDF` header, uploads the bytes to the private `reports` storage bucket
  at `{user_id}/{source_id}/{uuid}.pdf`, and inserts a `reports` row. Logic in
  `backend/reports.js` (Workers-compatible: `node:crypto` + fetch-based
  Supabase SDK, raw-body upload). UI: `src/pages/reports/Reports.jsx` (source
  cards + "Add report source" → shows endpoint + token + curl) and
  `src/pages/reports/ReportSourceDetail.jsx` (received PDFs: view/download via
  signed URL, delete, regenerate token, delete source). Dashboard `reports`
  widget rolls up recent PDFs; the Master Controller reads `report_sources` /
  `reports` metadata (read-only — it can't open PDF contents) and lists recent
  ones in the snapshot under `reports`. CTRLpanel never sends anything.

## Design System (unchanged — FOLLOW EXACTLY)
```css
:root {
  --bg-base:#0a0808; --bg-surface:#141010; --bg-elevated:#1a1414;
  --border:#1e1818; --border-bright:#2a2020;
  --accent:#e11d48; --accent-dim:rgba(225,29,72,.12); --accent-glow:rgba(225,29,72,.25);
  --text-primary:#f0e8e8; --text-secondary:#8a7070; --text-muted:#3d2e2e;
  --font:'Inter',sans-serif; --radius-sm:6px; --radius-md:8px; --radius-lg:12px;
  --transition:150ms ease;
}
```
Glass-morphism `.card`, `pulse-border` + `breathe` animations, 11px uppercase
section labels, 13px body. Accent is swappable per user (Settings) — never
hardcode `#e11d48` in components; use `var(--accent)`. Shared styles live in
`src/styles/components.css`; reuse `.btn .input .card .badge .list-row
.edit-row .toolbar .segmented .switch` etc. before inventing new ones.

## API Surface (`/api/*` — identical in Express and the Worker)
- `GET  /api/health`
- `POST /api/ai/chat` (NDJSON stream) · `POST /api/ai/supplement-analyze` · `POST /api/ai/interaction-check`
- `GET  /api/finance/prices?tickers=A,B`
- `GET  /api/calendar/status|connect|callback|calendars|events` ·
  `POST /api/calendar/disconnect|events` · `PATCH|DELETE /api/calendar/events/:id`
  (auth = Supabase access token via `Authorization: Bearer` or `?token=`)
- `POST /api/shares/board` (share a to-do board by email) ·
  `POST /api/invites/accept` (redeem a board OR friend invite token)
- `GET|POST /api/social/friends` · `DELETE /api/social/friends/:id` ·
  `GET /api/social/leaderboard?metric=&days=` · `GET|POST /api/social/challenges` ·
  `POST /api/social/challenges/:id/respond` · `DELETE /api/social/challenges/:id`
  (all Supabase-token auth; logic in `backend/social.js`, emails in `backend/email.js`)
- `POST /api/nutrition/log` — external clients; auth = per-user API key
  (`Authorization: Bearer ctp_…` or `X-API-Key`), logic in `backend/nutritionApi.js`
- `POST /api/reports/ingest` — external clients send a PDF (raw body,
  `Content-Type: application/pdf`); auth = per-source token
  (`Authorization: Bearer ctpr_…` or `X-API-Key`), optional `X-Report-Title`
  header; logic in `backend/reports.js` (uploads to the `reports` storage bucket)

## Deployment — ONE story: Cloudflare
- `worker/index.js` is the production backend; it reuses the modules in
  `backend/` (claude.js, google.js, finance.js). `wrangler.jsonc` serves
  `./dist` as SPA assets with `run_worker_first: ["/api/*"]` + `nodejs_compat`.
- Deploy: `npm run deploy` (build + `wrangler deploy`). Secrets via
  `npx wrangler secret put` — list in wrangler.jsonc header and `.env.example`.
- Local dev stays Vite + Express (`npm run dev` + `npm run server`).
- **If you add an API route, add it to BOTH `backend/routes/*` and
  `worker/index.js`, keeping logic in a shared `backend/*.js` module.**

## Rules — Agent Must Follow
1. Read this file + `supabase-schema.sql` before writing code.
2. No Tailwind/Bootstrap/MUI/etc. Pure CSS custom properties only.
3. Supabase via `src/lib` only; Claude via `backend/claude.js` only.
4. Every feature is per-user: rely on RLS + `user_id default auth.uid()`;
   never write code that shows one user's data to another; never seed demo data.
5. One component per file; check what exists before creating files (see Feature Map).
6. Every page must be visually complete (empty states, not blank) and styled
   with the design system.
7. Backend code must stay Worker-compatible (rule 6 under Architecture) and be
   registered in both route tables.
8. Schema edits are idempotent, appended to `supabase-schema.sql`, added to the
   RLS loop, and called out to the user (they re-run the file in Supabase).
9. Model string `claude-sonnet-4-6` is correct — leave it unless the owner asks.
