# CTRLpanel — Project Context for Agents

> Read this file at the start of EVERY session before writing code.
> **`supabase-schema.sql` is the single source of truth for the database.**
> This doc describes architecture and conventions; when in doubt about a
> column or table, read the schema file — do not trust memory or old docs.

## Identity
- App name: CTRLpanel · Tagline: by cwmccann.pro · Owner: Cameron McCann
- Purpose: private, personal Life OS for the owner. Authentication and RLS stay
  in place for data safety, but there are no cross-user collaboration features.
- Local dev: frontend http://localhost:5173 (Vite) + API http://localhost:3001 (Express)
- Production: Cloudflare Worker (API) + static assets, single deploy — see Deployment.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, plain CSS custom properties (NO Tailwind, NO component libs) |
| Auth + DB | Supabase (email auth; Postgres with Row-Level Security on every table) |
| Backend (local dev) | Node + Express (`backend/server.js`, port 3001; Vite proxies `/api`) |
| Backend (production) | Cloudflare Worker (`worker/index.js`) serving the same `/api` surface + `./dist` assets |
| AI | Anthropic Claude API — model `claude-sonnet-4-6` (valid, current alias for Claude Sonnet 4.6 — do not "fix" it); the Agents folder uses its own `AGENT_MODEL` = `claude-opus-5` in `backend/claude.js` |
| Google Calendar | Two-way sync via plain REST OAuth (`backend/google.js`, no googleapis dependency — must stay Workers-compatible) |
| Icons / Charts / DnD / Canvas | Tabler webfont · Recharts · @dnd-kit · @excalidraw/excalidraw (lazy-loaded) |

## Architecture — the rules that keep this private
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
     can never read OAuth tokens) and for headless writers like the
     Opportunities Agent run (`opportunities` + `opportunity_runs` rows, written
     with the verified session's user_id).
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
- Tasks: `boards` (per-user, `columns` jsonb = custom Kanban columns), `tasks`
- Projects: `projects` (+ `charter` jsonb, `notes_list` jsonb, `files` jsonb
  [{title,url,type,added_at}], `service_links` jsonb [{id,label,url,icon,paid}]
  = per-project Services quick-links bar, `excalidraw` scene jsonb,
  `excalidraw_preview`, `crm_board_id` → linked CRM page)
- CRM: `crm_boards` (multiple CRM pages, `columns` jsonb = custom columns,
  + `spreadsheet_id`/`spreadsheet_url`/`spreadsheet_title`/`sheet_name` when the
  page is backed by a Google Sheet), `crm_contacts` (+ `board_id`, `custom`
  jsonb for custom-column values — only used by non-sheet-backed pages),
  `google_sheets_tokens` (service-role only, RLS with no policy)
- Calendar: `calendar_events` (local fallback; Google is primary when connected),
  `google_tokens` (service-role only)
- Socials: `youtube_channels` (service-role only; per-user OAuth tokens + cached
  channel stats, exposed to the owner only through `/api/youtube/*`)
- Health: `nutrition_logs` (+ `notes`), `weight_logs`, `water_logs`,
  `user_goals` (+ `water`), `supplements`, `supplement_logs`,
  `fitness_schedule`, `workout_logs`
- Nutrition API: `api_keys` (hashed per-user keys for the external logging endpoint)
- Habits: `habits`, `habit_logs` (unique habit_id+log_date)
- Finance: `accounts`, `net_worth_snapshots`, `income_sources`,
  `expense_categories`, `transactions`, `holdings`, `portfolio_snapshots`, `dividends`
- Socials: `youtube_channels` (one row per connected channel: channel_id,
  title/thumbnail, `label` = the user's own name for the section (nullable,
  falls back to title), cached sub/video/view counts, google_email + OAuth tokens —
  service-role only, RLS enabled with NO policy, same pattern as google_tokens;
  unique on (user_id, channel_id) so a user can connect many channels)
- Agents: `agent_configs` (one row per user per agent — `agent_key` +
  `config` jsonb, unique on (user_id, agent_key)), `opportunity_runs` (one row
  per Opportunities Agent run: status running|complete|error, `summary` jsonb
  with the skills-to-build list, searches / tokens / `cost_usd`),
  `opportunities` (ranked finds, unique on (user_id, `dedupe_key` = normalized
  URL); `status` new|saved|applied|dismissed belongs to the user and is never
  overwritten by a re-run). **Never name new tables `agents` / `agent_runs`** —
  the schema's retired-features block still drops those on every re-run.
- Retired, data kept: `report_sources`, `reports` and the `reports` storage
  bucket from the removed Reports feature (no longer defined in the schema)
- **Schema changes**: append idempotent SQL (`create table if not exists`,
  `add column if not exists`) to `supabase-schema.sql` and add the table to the
  RLS loop. The whole file must always be safe to re-run.

## Feature Map (what exists — do not rebuild)
- **Dashboard** — card-less, fully **dynamic** layout on a horizontally extensible canvas. Panels render
  directly onto one seamless surface per column (hairline dividers between
  them), NOT in individual widget cards — keep it that way.
  · `src/pages/Dashboard.jsx` is only the **layout engine**: drag panels within
    and across columns (@dnd-kit multi-container sortable + `DragOverlay`),
    per-panel height resize (drag the bottom edge), remove, and an Add-panel
    picker grouped by section. A **Customize** toggle reveals that chrome; the
    dashboard is clean and read-only until then. Column widths drag too.
  · **Canvas**: any number of columns (up to `MAX_COLS` = 12, "Add column" in Customize, or
    "+ New" in the Add-panel picker); each has a pixel width that is a MINIMUM (260–900, default
    280) — spare room is shared out in proportion, overflow scrolls. The canvas (`.dash2-canvas`)
    is the 2D scroller: **hold the middle mouse button (wheel click) and drag to pan**
    (`lib/useMiddleClickPan.js`; the press is cancelled so the browser's autoscroll never starts,
    a drag swallows "open link in new tab"), plus Shift+wheel/trackpad and header ← → arrows that
    appear when it overflows. Customize adds a bar per column (move ◀ ▶, remove — its panels move
    to the neighbouring column, never lost). Below 1100px the columns stack and the page scrolls
    (middle-drag then pans the page vertically). Pure rules live in `lib/dashboardLayout.js`.
  · `src/components/dashboardPanels.jsx` is the **panel registry**. Every panel
    is self-contained (fetches its own rows) and receives `{ cfg, onCfg }` for
    its per-instance settings. Add an entry to `PANELS` and it shows up in the
    picker automatically — that is the only step needed for a new widget.
    Groups: Work (board column, due soon, quick add, schedule, projects, CRM,
    opportunities), Finance (net worth, cashflow, budget categories, portfolio),
    Health (macros, water, weight, supplements, training, workouts), Habits
    (week grid, consistency trend, life), Socials (YouTube).
  · Layout saved to `user_settings.dashboard_widgets` as
    `{ v:7, widths:[px,…], columns:[[{uid,id,cfg,h}],…] }`. `normalize()` migrates
    v6 (percentage `cols`, converted to px minus divider space) and older v4/v5
    shapes, so never assume the stored shape — run it through that.
  The Master Controller is NOT on the page — it's a global bottom dock (see
  below). The legacy `dashboardWidgets.jsx` registry is superseded and unused.
- **Sidebar** (`src/components/Sidebar.jsx`): top-level links (Dashboard,
  Calendar, To Do, Habits) + **folders**. A folder header is *only* a folder —
  clicking it expands/collapses, it never navigates. Sections with an overview
  page (CRM, Agents, Projects, Socials) expose it through the small `+` manage
  button on the header instead; that page is where new items get created.
  Open/closed state persists (localStorage + `ui_preferences.sidebar.folders`),
  as does the drag-resized width. Collapsed rail: hovering a folder icon opens a
  fixed-position flyout with the same sub-pages. Dynamic items come from
  `WorkspaceProvider` (projects, CRM boards, socials channels); the Agents
  folder lists `src/lib/agentRegistry.js`; Health + Finance are fixed lists.
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
  (Urgent→High→Medium→Low, stable within a tier). Boards and cards are
  owner-only; do not add sharing, membership, or invitation flows.
- **Projects**: list + per-project sub-pages (`/projects/:id`, dynamic sidebar
  items) with 6 tabs: Project Dashboard (per-project Services quick-links bar
  [add presets/custom, drag-reorder, "Paid" tags; `src/components/ServiceLinks.jsx`,
  saved to `projects.service_links`] + Charter + live roll-ups), Excalidraw
  (persisted scene + thumbnail), Board, Notes (pinnable, markdown), Files &
  Links, People (synced with linked CRM page).
- **CRM**: multiple pages (`/crm/:boardId`, in sidebar). A page runs in one of
  two modes:
  · **Supabase-backed** (default): `crm_contacts` rows, custom columns per page,
    inline editing, search/sort/hide columns, CSV import, bulk delete.
  · **Google Sheets-backed**: link a page to a spreadsheet and *that sheet
    becomes the source of truth* — CTRLpanel reads rows live and writes inline
    edits / new rows / deletes straight back, so full editing power stays in
    Sheets. Row 1 is the header (defines the columns); every tab in the
    document is selectable, so one page can surface several sheets. An
    **Open in Google Sheets** button sits top-right. UI in
    `src/components/CrmSheet.jsx` (+ `LinkSheetModal`: paste a Sheets URL, or
    create a new spreadsheet seeded with headers).
    Backend `backend/sheets.js` — same Google OAuth client with its own
    redirect URI (`/api/sheets/callback`); tokens in `google_sheets_tokens`,
    service-role only, never sent to the browser. Workers-compatible
    (plain fetch + `node:crypto`).
    **Scope rule — do not add a Drive scope.** Drive scopes are *restricted*,
    and Google then requires every redirect URI on the OAuth client to be
    HTTPS, which breaks `http://localhost` dev. Only
    `.../auth/spreadsheets` (sensitive, localhost-friendly) is requested, which
    is why sheets are linked by URL rather than browsed from Drive.
- **Agents** (`/agents`, sidebar folder fed by `src/lib/agentRegistry.js`):
  on-demand AI agents. Add one with a registry entry, its page and its route
  in `src/main.jsx`; the overview (`src/pages/agents/Agents.jsx`) renders an
  `AgentCard` per entry. First agent: the Opportunities Agent (note below).
  Replaces the removed Reports section.
- **Habits**: tracker (14-day toggle grid, streaks) + Life View (birthdate,
  weeks-of-life; feeds the Life View widget).
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
- **Opportunities Agent** (`/agents/opportunities`,
  `src/pages/agents/OpportunitiesAgent.jsx`): "Run now" has Claude search the
  web and rank jobs, internships, programs/fellowships, events, certifications
  and competitions against the user's config, writing them to `opportunities`
  (score 0–100, reasons, Save / Applied / Dismiss); each run also returns
  "Skills to build". The gear opens `OpportunityConfigModal` (profile with
  "Import from resume PDF", current focus, industries, kinds, level, home base
  + in-person cities, remote-US / nationwide toggles, keywords, examples,
  search depth), saved to `agent_configs`. Defaults + `normalizeConfig` live in
  `src/lib/opportunityConfig.js`, shared with the backend.
  Backend: `backend/opportunities.js` orchestrates (retire stale runs → config
  → run row → research → verify each link's host against the search results →
  drop past deadlines/events → upsert on dedupe_key WITHOUT status → complete
  the run with cost). The Claude calls live in `backend/claude.js`:
  `researchOpportunities` (`AGENT_MODEL` `claude-opus-5`, adaptive thinking,
  `web_search_20260209` with `user_location`, strict `submit_opportunities`
  tool, `pause_turn` resume with the remaining search budget, one nudge,
  server-side refusal fallback to `claude-opus-4-8`) and `extractResumeProfile`.
  The run streams NDJSON progress with a 15s ping, because a web-search run
  takes minutes and the Worker edge drops idle responses after ~100s. Runs left
  `running` for 20+ minutes are marked interrupted by the next run. On demand
  only — no cron. Dashboard panel `opportunities`; the Master Controller reads
  `opportunities` (read-only) and lists top picks in its snapshot.

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
- `POST /api/ical/events` — read-only .ics feeds (see Calendar note; `backend/ical.js`)
- `POST /api/nutrition/log` — external clients; auth = per-user API key
  (`Authorization: Bearer ctp_…` or `X-API-Key`), logic in `backend/nutritionApi.js`
- `POST /api/agents/opportunities/run` `{ apiKey?, today }` → NDJSON progress
  stream · `POST /api/agents/opportunities/profile` `{ pdfBase64, apiKey? }` →
  `{ profile }` (Supabase-token auth; logic in `backend/opportunities.js` +
  `backend/claude.js`)
- `GET /api/youtube/status|connect|callback|analytics` ·
  `POST /api/youtube/disconnect` (Supabase-token auth except OAuth callback;
  logic in `backend/youtube.js`)
- `GET /api/sheets/status|connect|callback|list|meta|values` ·
  `POST /api/sheets/disconnect|cell|append|delete-rows|create`
  (Supabase-token auth except the OAuth callback; logic in `backend/sheets.js`
  — Google Sheets-backed CRM)

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

## Productivity + Knowledge Base update
- Context sync: `GET/POST /api/knowledge/notes` uses revocable `ctpk_` keys
  (`knowledge_api_keys`, browser-owned RLS). Shared backend logic is in
  `backend/knowledge.js`, registered in Express and Worker. The service-role
  writer derives ownership from the key and calls an atomic, version-checked
  `save_context_note` RPC. Never accept user_id from external payloads.
- Knowledge edits autosave after one second, with local draft recovery,
  Realtime and periodic refresh, and optimistic concurrency. Keys and the
  requested Prompts initializer are in Knowledge Base → Context sync.
- `tools/ctrlpanel-mcp.mjs` exposes read_context, save_context, and
  initialize_prompts over local stdio MCP. See `docs/context-sync.md` for
  deployment, client configuration, API contract, and activation limitations.
- Calendar is now a read-only month/week overview with a selected-day agenda
  (`src/pages/Calendar.jsx`, `src/lib/calendarView.js`). Event writes are absent
  from the page; Google events are read for the visible range. Manage events
  through Google Calendar. Date-only and overnight events use local-day overlap.
  **iCal feeds** (Calendar → Feeds): read-only `.ics` / `webcal://` URLs (iCloud "Public
  Calendar" links etc.) saved in `user_settings.ui_preferences.calendar.feeds`
  `[{id,label,url,color}]` — no schema change, no OAuth. Colours come from a curated
  palette (`FEED_COLORS`); a new feed takes the nearest swatch to its own
  `X-APPLE-CALENDAR-COLOR`, and the Feeds dialog has a per-feed picker.
  `POST /api/ical/events` `{feeds,timeMin,timeMax,tz}` (Supabase-token auth; POST so the
  secret URL stays out of logs) → `{events,feeds:[{id,ok,count,suggestedColor?,error?}]}`;
  logic in `backend/ical.js` (Workers-compatible; hand-written parser: RRULE/EXDATE/RDATE,
  RECURRENCE-ID overrides, TZID via Intl, floating times use the viewer's `tz`; a repeating
  event longer than its own interval is shown as a 1h marker). The server refuses non-https,
  IP-literal, localhost/internal hosts and re-checks every redirect hop.
  `useCalendarEvents` (dashboard/review/projects) merges feeds in. Not yet fed to the Master
  Controller snapshot (`mcTools.js`).
  **Week view = time grid** (`CalendarWeekGrid.jsx`, pure layout in `lib/weekLayout.js`): 6 AM–12 AM
  vertical axis, events positioned/sized by duration, side-by-side lanes for overlaps, now-line,
  all-day row, per-day booked bar; hour height fits the window (min 30px). The page opens on Week.
  **Time-blocking To Do tasks** (`TaskTray.jsx`, `useTaskPlanner.js`, pure `lib/taskBlocks.js`):
  drag a task from the tray (or ⚡ "next free slot", or the task dialog's exact time) onto the
  grid; snaps to 15 min and magnetises to neighbouring event edges, ghost shows the landing
  slot/conflicts; blocks can be dragged, resized from the bottom edge, ticked off (moves the task
  to its board's Done column) or removed. Blocks live in
  `ui_preferences.calendar.blocks` `{taskId:{start,mins}}` (no schema change; stale ids for deleted
  tasks are ignored). Move to `tasks` columns if it ever needs querying server-side.
  **Dashboard `schedule` panel is now the Day Plan** (`DayPlanPanel.jsx`): Now/Next card, booked/free
  stats, a 1-column `CalendarWeekGrid` (same drag/resize/snap), and "Needs a time" tasks with ⚡.
  **Task rows in other dashboard panels (To Do board columns, Due Soon, Today) drag onto the Day Plan**:
  the in-flight drag is a module-level store (`lib/taskDrag.js`, `useTaskDrag()`), because source and
  target are different panels; rows opt in with `useTaskDragSource()` (`lib/useTaskDragSource.js`:
  `dragProps(task)`, `rowClass(task)`, `plannedAt(task)` → clock marker). Re-dragging a planned task
  moves it and keeps its length. Overlapping blocks (task/task or task/event) stack side by side via the
  `weekLayout` lanes; the drop ghost previews its lane ("Beside N items") instead of warning.
  Tests: `tests/ical.test.mjs`, `weekLayout.test.mjs`, `taskBlocks.test.mjs`, `taskDrag.test.mjs`.
- Generic section headings are visually hidden but retained for accessibility.
  To Do's board selector is the heading; shared chrome uses restrained surfaces,
  inset segmented controls, and reduced-motion-aware transitions.
- `/knowledge` is the private Markdown library (`src/pages/KnowledgeBase.jsx`).
  `knowledge_notes` is defined at the end of `supabase-schema.sql`; apply that
  migration before using the feature. RLS checks note ownership and project ownership.
- Editor: write/split/read, GFM tables and tasks, formatting controls, Ctrl+S,
  explicit save status, conflict detection, folders, tags, pins, Markdown file
  import/export, `[[wiki links]]`, backlinks, and rename aliases.
- Graph: whole library or filtered notes, pan/zoom, keyboard-selectable nodes.
  Project Detail → Knowledge embeds the same library with a project-scoped graph.
  Assign notes using the Project field. Existing project Notes remain accessible.
- The dashboard defaults to work panels and Knowledge Base. Customize → Work
  layout restores this layout. Unmodified old defaults migrate automatically.
- Nutrition is a plain log; the former social module and macros/water panels
  are retired. Historical data is retained.
- **Command palette** (Ctrl/⌘+K, topbar "Search or add"): `src/components/CommandPalette.jsx`
  (provider + overlay, mounted once in `App.jsx`) over the pure `src/lib/commandPalette.js`
  (ranking, `parseCapture`, `formatDue`, `PAGES` — keep it import-free so `node --test` can load it).
  Jumps to pages/projects/boards/CRM/agents/channels/notes/tasks, ticks today's habits, and
  captures tasks: `Call dentist @fri !high` (`@today|tomorrow|mon…|3d|2w|9/14|YYYY-MM-DD`,
  `!urgent|high|med|low`), Ctrl+Enter adds as a task from anywhere. Task/note/habit data is
  prefetched and cached for the shell's lifetime; writes patch the cache and call
  `notifyDataChanged(table)` (`useData.js`) so mounted `useRows`/`useCrud` reload.
  New destinations only need an entry in `PAGES` or the item list in the palette.
- **Today layout** (default dashboard): panels `today_tasks` (overdue + due-today tasks, one-click
  complete with Undo, capture box that understands `@date`/`!priority` and defaults to due today) and
  `today_habits` (checklist, progress bar, live streaks via `currentStreak` in `habits.js`), registered
  in a new "Today" picker group. `LAYOUTS` in `dashboardPanels.jsx` holds the `today` and `work`
  presets (Customize → Today layout / Work layout). `normalize()` in `Dashboard.jsx` moves a saved
  layout that is still the untouched Work layout (no panel heights/settings) to Today.
  `doneColumn(board)` / `taskRowFromCapture()` in `src/lib/commandPalette.js` are shared by the
  palette and the Today panel.
- **Dates — never use `toISOString().slice(0, 10)` for a day.** It is UTC, so after ~8pm in the US it
  names tomorrow. Use `dayKey(date)` (`helpers.js`, re-exported by `habits.js`) for "today"/per-day
  keys and `parseLocalDate(str)` for date-only strings from the DB (due dates, transaction dates).
- **Themes** (Settings → Theme): Crimson (default, tokens in `globals.css`), Midnight, Graphite,
  Forest, AMOLED, Light and System. A theme only overrides surface/border/text tokens
  (`src/styles/themes.css`, applied as `<html data-theme>` by `src/lib/themes.js`); the accent stays
  the user's own pick. Saved in localStorage (`ctrlpanel-theme`, painted before first render by an
  inline script in `index.html` — keep its id list in sync) and `ui_preferences.appearance.theme`.
  **Never hardcode a surface/border/text colour** in CSS or JSX (charts use `var(--border)` etc.);
  use the tokens or the theme breaks. `tests/themes.test.mjs` enforces a complete token set and
  WCAG contrast (primary 7:1, secondary 4.5:1, muted 3:1) for every non-default theme. The default
  Crimson `--text-muted` is ~1.5:1 on its surfaces — fixed by the design system, left alone.
- **Phone layout** (`src/styles/mobile.css`, loaded after `components.css`/`themes.css`): below 760px
  (`MOBILE_QUERY` in `src/lib/useMediaQuery.js` — keep the CSS in sync) the sidebar is an off-canvas
  drawer opened by a topbar hamburger (`App.jsx` owns `navOpen`; closes on route change, backdrop, Esc).
  On phones/touch (`pointer: coarse`) the Master Controller hover dock becomes a 52px floating button,
  controls get ≥40px targets and 16px inputs (no iOS zoom), and CRM cells edit on a single tap.
  Dashboard columns already stack below 1100px. New pages must not overflow at 375px.
- **Installable app (PWA)**: `public/manifest.webmanifest` (+ shortcuts), icons generated by
  `node scripts/make-icons.mjs` into `public/icons/` (maskable included) + `public/favicon.svg`,
  per-theme `<meta name="theme-color">` (inline script in `index.html` + `themes.js`, kept in sync by a
  test), `OfflineBanner`. `public/sw.js` (registered by `src/lib/registerSW.js`, **production only**)
  caches only the app's own code (index.html shell, hashed `/assets/*`, icons) and the font/icon CDNs.
  It **never** touches `/api/*`, Supabase, Google, any other cross-origin host, or non-GET requests —
  `tests/pwa.test.mjs` runs it in a sandbox to enforce that. Bump `VERSION` in `sw.js` to drop old caches.
- **Routes** live in `src/routes.jsx` (`appChildren`), shared by `main.jsx` and the test harness.
  **Every page is `React.lazy`** (its own chunk) — never import a page statically; add a new page to
  `loaders` there (and to `pageLoaders` for idle prefetch). First visit = shell + the page you open
  (~157 kB gzip; budget 200 kB, enforced by `tests/architecture.test.mjs` after `npm run build`);
  `node scripts/bundle-report.mjs` shows initial vs lazy. `vite.config.js` splits `react-vendor` and
  `supabase` for long-term caching. Heavy libs (recharts, markdown via `LazyMarkdown`, Excalidraw,
  mermaid) must stay out of the entry path. `lib/prefetch.js` warms every page chunk while idle after
  sign-in (skipped on data-saver/2G), and the service worker caches them at runtime, so visited or
  prefetched pages work offline.
- **Crash containment**: `ErrorBoundary` wraps each page inside the shell (`resetKey={pathname}`), so a
  throwing page shows a "Try again / Reload" panel while the sidebar, topbar and palette keep working;
  `RouteError` is the router `errorElement` for shell failures. A lazy chunk that fails to load (offline,
  or a deploy removed the file) auto-reloads once per 30s, then shows a reload-only message
  (`src/lib/errors.js`). Knowledge notes are normalized at the boundary (`lib/noteShape.js`) so a row
  missing `tags` can't crash the page.
- **Weekly review** (`/review`, sidebar "Weekly Review", palette): last 7 days vs the 7 before —
  habits (rate, streaks, weakest), tasks (due vs done, overdue, coming up), training, nutrition, weight,
  spending vs budget, notes written, next 7 days of events. Pure logic in `src/lib/review.js`
  (`buildReview`, ISO weeks, `reviewNoteTemplate`); "Start review note" creates/opens a Knowledge note
  titled "Weekly review YYYY-Www" (folder `Reviews`) — no schema change, never duplicates.
- **Cross-links** (`src/lib/links.js`, no new columns): project → `todo_board_id` → tasks; notes via
  `knowledge_notes.project_id`; events match a project by name in the title. Project chips appear on
  To Do cards (All Boards view), Today rows, review tasks, palette results and the Knowledge list; a
  project's own board links back to it; the task editor has a Project picker (moves the task to that
  project's board); the Project page has "Coming up" and "Knowledge" roll-ups. `src/lib/boards.js`:
  "All Boards" shows every custom column too, and cards can only be dropped in a column their board has.
- **AI one-taps** (`src/lib/prompts.js`, `AI_ACTIONS`): Plan my day / Weekly review / What's overdue?
  from the palette ("Ask"), the Master Controller empty state, the dock quick button, the Today
  panel's ✨ button and the Review page. They only send a prompt (the MC already has the snapshot and
  read tools); they never change data unasked. The palette sits inside `MasterControllerProvider`.
- **Toasts**: `useToast()` from `src/components/Toaster.jsx` (`toast('Saved')`,
  `toast({ tone:'error', message, action:{label,onClick} })`); styles in `src/styles/overlays.css`.
- Run `node --test tests/*.test.mjs` and `npm run build` for verification.

## CRM Sheets (service account) — read + edit
- CRM pages need an attached Google Sheet; the CRM overview lists pages. Auth is a Google **service
  account** (no OAuth — see `backend/sheets.js` header for why). Credentials: `GOOGLE_SERVICE_ACCOUNT_JSON`
  (whole key file, raw or base64) or `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_KEY`.
  `LinkSheetModal` shows step-by-step setup when unconfigured and a **live connection check**
  (`GET /api/sheets/check`: signs in, then probes the API, so a bad key / disabled API / not-shared
  each give their own message). Recommend sharing as **Viewer** (read-only) or **Editor** (edit here).
- `backend/sheets.js` throws typed `SheetsError`s (`not_configured`, `auth`, `api_disabled`, `not_shared`,
  `read_only`, `tab_missing`, `rate_limited`, …) which the API returns as `{ error, code }` and the UI
  reads from `err.code`. **One dispatcher, `handleSheetsRequest`, serves both Express
  (`backend/routes/sheets.js`) and the Worker** — add routes there, never in two places.
  Reads use `FORMATTED_VALUE` (dates/currency as Sheets shows them), cap at `MAX_ROWS` (10,000) with
  `truncated: true`, de-duplicate headers (`Name (2)`), drop blank rows; rows are `{ row, cells }`.
- `CrmSheet` (+ pure `src/lib/sheetsTable.js`, cache `src/lib/sheetsCache.js`): instant paint from a
  stale-while-revalidate cache then background refresh (also on window focus), 200-row paging,
  search/filters/sort (numbers, currency, dates), clickable email/phone/URL cells, inline cell edit
  (double-click / Enter; Tab, Esc, blur), Add row, multi-select Delete. A write that Google rejects as 403
  flips the page to a **View only** state (`read_only`). Bulk delete re-reads the sheet and aborts if the
  selected rows moved (`staleSelection`) — rows shift when the sheet is edited elsewhere.
- Tests: `tests/sheets.test.mjs` runs the backend against a fake Google (real RS256 key; the fake token
  endpoint verifies the JWT signature); `tests/sheetsTable.test.mjs` covers the table logic.
- Page rename, spreadsheet replacement, and page deletion live in the page options menu. Existing local
  crm_contacts rows are retained; no database migration is needed.
