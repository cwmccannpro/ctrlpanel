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
  dashboard_widgets jsonb, `ui_preferences` jsonb, birthdate/life_expectancy
  for Life View)
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
- Socials: `youtube_channels` (service-role only; per-user OAuth tokens + cached
  channel stats, exposed to the owner only through `/api/youtube/*`)
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
- Socials: `youtube_channels` (one row per connected channel: channel_id,
  title/thumbnail, `label` = the user's own name for the section (nullable,
  falls back to title), cached sub/video/view counts, google_email + OAuth tokens —
  service-role only, RLS enabled with NO policy, same pattern as google_tokens;
  unique on (user_id, channel_id) so a user can connect many channels)
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
- **Dashboard** — card-less, fully **dynamic** 3-column layout. Panels render
  directly onto one seamless surface per column (hairline dividers between
  them), NOT in individual widget cards — keep it that way.
  · `src/pages/Dashboard.jsx` is only the **layout engine**: drag panels within
    and across columns (@dnd-kit multi-container sortable + `DragOverlay`),
    per-panel height resize (drag the bottom edge), remove, and an Add-panel
    picker grouped by section. A **Customize** toggle reveals that chrome; the
    dashboard is clean and read-only until then. Column widths drag too.
  · `src/components/dashboardPanels.jsx` is the **panel registry**. Every panel
    is self-contained (fetches its own rows) and receives `{ cfg, onCfg }` for
    its per-instance settings. Add an entry to `PANELS` and it shows up in the
    picker automatically — that is the only step needed for a new widget.
    Groups: Work (board column, due soon, quick add, schedule, projects, CRM,
    reports), Finance (net worth, cashflow, budget categories, portfolio),
    Health (macros, water, weight, supplements, training, workouts), Habits
    (week grid, consistency trend, life), Socials (YouTube).
  · Layout saved to `user_settings.dashboard_widgets` as
    `{ v:6, cols:[l,m], columns:[[{uid,id,cfg,h}],…] }`. `normalize()` migrates
    older v4/v5 shapes, so never assume the stored shape — run it through that.
  The Master Controller is NOT on the page — it's a global bottom dock (see
  below). The legacy `dashboardWidgets.jsx` registry is superseded and unused.
- **Sidebar** (`src/components/Sidebar.jsx`): top-level links (Dashboard,
  Calendar, To Do, Habits) + **folders**. A folder header is *only* a folder —
  clicking it expands/collapses, it never navigates. Sections with an overview
  page (CRM, Reports, Projects, Socials) expose it through the small `+` manage
  button on the header instead; that page is where new items get created.
  Open/closed state persists (localStorage + `ui_preferences.sidebar.folders`),
  as does the drag-resized width. Collapsed rail: hovering a folder icon opens a
  fixed-position flyout with the same sub-pages. Dynamic items come from
  `WorkspaceProvider` (projects, report sources, CRM boards, socials channels);
  Health + Finance are fixed lists.
- **Master Controller dock**: `MasterControllerDock` in
  `src/components/MasterController.jsx`, rendered once in `App.jsx`. Fixed to
  the bottom on every page, hidden until the pointer comes within ~100px of the
  bottom edge, then springs up (bubble effect). There is no topbar MC button.
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
  charts compute from real user data. **Investing** uses real market data from
  Yahoo Finance (`backend/finance.js`, plain fetch, no key; crypto maps to
  `<SYM>-USD`): live quotes polled every 10s (`/api/finance/prices`), a
  full-width portfolio performance chart with a 1W–ALL scale selector
  (`/api/finance/portfolio-history`, reconstructed from each holding's real
  history × shares), Holdings + Allocation side by side, and a per-holding
  detail modal with its own price chart (`/api/finance/history`).
- **Master Controller**: streaming chat (NDJSON over `/api/ai/chat`); frontend
  drives the agentic loop executing `query_records` / `create_record` /
  `update_record` / `delete_record` (+ `navigate_to`) via `src/lib/mcTools.js`
  against the RLS-scoped client; calendar tools route to Google when connected;
  delete requires in-app confirmation.
- **Settings**: profile, accent (8 swatches → CSS vars, per-user), font size,
  Connectors (Anthropic key, Alpha Vantage, custom) saved to `user_settings.connectors`;
  Nutrition API keys panel.
- **Socials** (`/socials`, `src/pages/socials/Socials.jsx`): **modular like
  Projects** — every connected channel is its own renameable section with its
  own sidebar entry and its own page (`/socials/youtube/:id`,
  `src/pages/socials/YouTube.jsx`). The overview lists the sections and is where
  channels are connected / renamed / disconnected. Renaming writes
  `youtube_channels.label` (`POST /api/youtube/rename`); the real channel title
  is kept underneath and shown as the fallback (`channelLabel()` in
  `src/lib/helpers.js`), so several YouTube channels stay distinguishable.
  Per-user, **multi-channel** analytics — nothing is hardcoded to one channel.
  "Connect channel" runs a Google OAuth flow reusing the app's OAuth client with
  its own redirect URI (`/api/youtube/callback`) and read-only scopes
  (`youtube.readonly`, `yt-analytics.readonly`); whatever channel(s) the account
  owns are upserted into `youtube_channels`. Analytics are **pulled on request**
  (load, range change, Refresh): views / watch hours / net subs totals + daily
  series over 7d|28d|90d|1y, charted. Logic in `backend/youtube.js`
  (Workers-compatible, plain fetch + `node:crypto`; tokens live on the row and
  are refreshed server-side, never sent to the browser). The channel list is
  fetched once app-wide by `WorkspaceProvider` (`socials`) so the sidebar and
  the pages share it; range persists via `user_settings.ui_preferences.youtube`.
  A compact roll-up of the same data sits in the dashboard's middle column.
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
- `GET  /api/finance/prices?tickers=A,B` · `GET /api/finance/history?ticker=&scale=` ·
  `POST /api/finance/portfolio-history` `{ holdings:[{ticker,shares}], scale }`
  (Yahoo Finance, no key; scales 1D/1W/1M/3M/6M/1Y/5Y/ALL)
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
- `GET /api/youtube/status|connect|callback|analytics` ·
  `POST /api/youtube/disconnect` (Supabase-token auth except OAuth callback;
  logic in `backend/youtube.js`)

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
