# CTRLpanel — Setup & Deployment

Multi-user Life OS: React + Vite frontend, Supabase (auth + Postgres + RLS),
Express API for local dev, **Cloudflare Worker for production** (one deploy
story — the Worker serves both the API and the built frontend).

---

## 1. Supabase (required)

1. https://supabase.com → **New Project** (name it anything, e.g. `ctrlpanel`).
2. **SQL Editor → New query** → paste the ENTIRE contents of
   `supabase-schema.sql` → **Run** → expect "Success. No rows returned."
   - The file is idempotent — re-run it any time the schema changes.
3. **Authentication → Providers → Email** → enable.
   For instant test logins, turn OFF "Confirm email" (turn it back on for production).
4. **Project Settings → API** — you need THREE values:
   | Value | Goes in | Notes |
   |---|---|---|
   | Project URL | `VITE_SUPABASE_URL` | safe for frontend |
   | `anon` `public` key | `VITE_SUPABASE_ANON_KEY` | safe for frontend (RLS-scoped) |
   | `service_role` SECRET | `SUPABASE_SERVICE_ROLE_KEY` | **backend only — bypasses RLS.** Required for Google Calendar OAuth (`google_tokens` is service-role-only) and for inbound PDF report ingestion (writes `reports` + the `reports` storage bucket). Never expose or commit it. |

## 2. Anthropic (Master Controller + supplement AI)

- console.anthropic.com → API Keys → create → `ANTHROPIC_API_KEY`.
- Optional: individual users can instead add their own key in
  **Settings → Connectors** inside the app (per-user keys take precedence).

## 3. Google Calendar OAuth (optional but recommended)

1. console.cloud.google.com → create a project → **enable "Google Calendar API"**.
2. **OAuth consent screen**: External · fill app name/emails · add scope
   `https://www.googleapis.com/auth/calendar` · while in **Testing** mode, add
   each Google account that will connect under **Test users** (refresh tokens
   expire every 7 days in Testing; publish + verify the app for public use).
3. **Credentials → Create → OAuth client ID → Web application** and add BOTH
   redirect URIs:
   - `http://localhost:3001/api/calendar/callback` (local dev)
   - `https://YOUR-DOMAIN/api/calendar/callback` (production Worker)
4. Copy Client ID/Secret → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and set
   `GOOGLE_REDIRECT_URI` to whichever environment you're configuring.

## 4. Local development

```bash
cp .env.example .env    # fill in the values from steps 1–3
npm install
npm run server          # Express API  → http://localhost:3001
npm run dev             # Vite frontend → http://localhost:5173  (proxies /api)
```

Open http://localhost:5173 → **Create one** (register) → you land in your own
empty workspace. Restart both processes whenever `.env` changes.

## 5. Production — Cloudflare (the one deploy story)

The Worker (`worker/index.js`) serves the same `/api` surface as Express by
reusing the same `backend/` modules, and `wrangler.jsonc` serves `./dist` as a
single-page app with `/api/*` routed to the Worker first.

```bash
# one-time: authenticate wrangler
npx wrangler login

# set every secret (same names as .env):
npx wrangler secret put VITE_SUPABASE_URL
npx wrangler secret put VITE_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI   # https://YOUR-DOMAIN/api/calendar/callback
npx wrangler secret put FRONTEND_URL          # https://YOUR-DOMAIN
npx wrangler secret put ALPHA_VANTAGE_KEY     # optional (stock prices)

# build + deploy (also available as: npm run deploy)
npm run build && npx wrangler deploy
```

Then attach your domain in the Cloudflare dashboard (Workers → your worker →
Domains & Routes), and make sure that domain's callback URL is registered on
the Google OAuth client (step 3.3).

Notes
- `VITE_*` values are baked into the frontend at **build time** from `.env` —
  build with the same values you set as secrets.
- Local test of the production bundle: `npm run cf:dev` (wrangler dev).
- If you add an API route: implement the logic in a shared `backend/*.js`
  module and register it in BOTH `backend/routes/*` and `worker/index.js`.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Login page says "Supabase isn't configured" | `.env` missing `VITE_*` values, or dev server not restarted |
| Register succeeds but can't sign in | Email confirmation is ON — click the link, or disable it (step 1.3) |
| Calendar `status` returns `ready:false` | `SUPABASE_SERVICE_ROLE_KEY` (or Google vars) missing on the backend |
| Google consent shows "access blocked / unverified" | Add your Gmail under OAuth consent → Test users |
| Master Controller errors about API key | Set `ANTHROPIC_API_KEY`, or add a key in Settings → Connectors |
| Table/column "does not exist" errors | Re-run `supabase-schema.sql` (it's idempotent) |
