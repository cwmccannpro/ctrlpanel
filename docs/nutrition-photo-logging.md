# Nutrition photo logging

Nutrition has two entry paths into the same private `nutrition_logs` table.

## In the mobile app

Open **Health → Nutrition** and choose **Log meal by photo** or **Describe a meal**.
Take a photo with the rear camera, choose one from the library, or type what you ate
(for example, “Dunkin bacon egg and cheese”). Select **Estimate meal**, review the
read-only calories and macros, then **Save meal**. There are no manual nutrition
fields. Correct portions or ingredients by changing the description/photo details
and estimating again. Editing an existing meal updates that entry.

The Nutrition dashboard panel opens either method directly. Links accept
`?log=photo` / `?log=text`; the earlier `?photo=1` link still works.

Each successful analysis displays an estimated USD cost from its input/output
token usage at Sonnet 4.6's standard $3/$15 per million token rates. A typical
small request is roughly 0.5–2 cents; length, image size and re-analysis change
the cost. These are API charges, separate from subscriptions and hosting.
Rates: [official Sonnet 4.6 pricing](https://platform.claude.com/docs/en/models/sonnet-4-6/overview).
Named restaurant items remain estimates, with serving assumptions shown;
analysis does not retrieve a live restaurant menu.

The signed-in session authenticates analysis. The server reads the owner's enabled
Anthropic connector first, falling back to `ANTHROPIC_API_KEY`. All Claude calls stay
in `backend/claude.js` and use the existing `claude-sonnet-4-6` model. The photo is
resized to JPEG in the browser, stripping camera metadata; the server receives
at most 600 KB of image bytes. CTRLpanel stores reviewed meal values and notes,
not the uploaded image. Photos are sent to Anthropic for analysis unless your
desktop model handles them (below).

## Desktop model first (free when your PC is on)

If you connect a Windows desktop running [Ollama](https://ollama.com), every
estimate goes there first and costs nothing. Claude is used only when the desktop
is off, its model isn't loaded, it's busy, it fails, it returns an unusable
estimate, or it takes longer than about 42 seconds. The meal editor shows where
each estimate ran. Local estimates use the same instructions as Claude. The
desktop schema also makes the model list each component (grams + macros) before
the totals, and the bridge sums those items itself; this measurably cut
undercounting. It runs with a 4096-token context so a 7B model fits entirely on
an 8 GB GPU (8192 spilled 14% to CPU), and caps answers at 1,200 tokens, retrying
once. Measured on an RTX 5060 (text meals): ~11 s cold, ~3–7 s warm, 11 of 12
answers usable first time. Accuracy is clearly below Claude: totals still tend
to run low (e.g. a Chipotle bowl at ~680 kcal), confidence is often overstated,
and micronutrients are mostly left empty. Photos were not benchmarked.

Setup, once:

1. Install Ollama, then `ollama pull qwen2.5vl:7b` (~6 GB; fits an 8 GB GPU).
   Any Ollama vision model works with `-Model <name>` below.
2. Apply `migrations/20261121-local-ai.sql` (also in `supabase-schema.sql`).
3. Settings → Nutrition → **Run estimates on your computer** → Create desktop key.
4. In this folder: `powershell -File tools/local-ai-install.ps1` and paste the key
   at the hidden prompt. Options: `-Model`, `-Origin` (default the production
   site), `-KeepAlive` (how long Ollama keeps the model in VRAM, default `15m`),
   `-KeepCredential` (reinstall without a new key).

The installer stores the key encrypted with Windows DPAPI in `.local-ai/`
(private ACL, gitignored) and registers the hidden logon task **CTRLpanel Local AI
Bridge**, which runs `tools/local-ai-bridge.mjs`. The bridge makes outbound
HTTPS requests only. It polls every 3 s while the model is ready and every 15 s
while it isn't, and it talks to Ollama on `127.0.0.1` only. It refuses
redirects and non-loopback model hosts. The `ctla_` key can only receive this
account's meal inputs and return estimates. Its SHA-256 hash is the only server
copy. The photo is removed from the job row when the desktop claims it, an
unclaimed job expires after 45 s, and a result is deleted once read. Log:
`.local-ai/bridge.log` (no keys or photos). Stop with
`Stop-ScheduledTask -TaskName 'CTRLpanel Local AI Bridge'`. Cut it off
immediately with **Disconnect desktop**.

## Connect an existing private custom GPT

1. Open **Settings → Nutrition**. Save your **Meal timezone** and deployed public
   HTTPS CTRLpanel address. ChatGPT cannot call localhost.
2. Generate a nutrition key. Copy it while the creation dialog is open.
3. Edit your GPT: **Configure → Actions → Authentication → API Key → Bearer**.
   Paste the raw `ctp_…` key in the authentication field. Keep the GPT private.
4. Copy the generated **Action schema** from CTRLpanel into the GPT action editor.
   Alternatively import `https://<your-domain>/api/nutrition/openapi.json` after
   deployment. No key is embedded in the schema.
5. Copy **GPT instructions** into the GPT's Instructions field and save it.
6. Use the action editor's **Test** on `checkNutritionConnection`. It checks the
   key and reads totals without creating a meal. Then send a real meal photo
   with “Log this meal” and verify it appears in Nutrition.

The GPT analyzes the image within ChatGPT and sends structured text values to
CTRLpanel. GPT Actions do not send the image itself. The action uses
`x-openai-isConsequential: false`, making the “always allow” option available;
ChatGPT may still request permission when connecting or invoking the action.

Official guidance: [authentication](https://developers.openai.com/api/docs/actions/authentication)
and [production requirements](https://developers.openai.com/api/docs/actions/production).

## API and ownership

One dispatcher, `handleNutritionRequest`, is used by Express and the Worker.

| Route | Authentication | Behavior |
| --- | --- | --- |
| `GET /api/nutrition/openapi.json` | Public | Credential-free action schema |
| `GET /api/nutrition/status` | Supabase session | Configuration and database readiness |
| `GET /api/nutrition/check` | Nutrition API key | Local-day totals/goals; no meal inserted |
| `POST /api/nutrition/log` | Nutrition API key | Save/replay one meal |
| `POST /api/nutrition/analyze` | Supabase session | Photo or description estimate (desktop model, else Claude) with `engine` and cost; no meal inserted |
| `GET /api/nutrition/local/status` · `POST local/pair`, `local/revoke` | Supabase session | Desktop model connection; pair returns a `ctla_` key once |
| `POST /api/nutrition/local/bridge/poll`, `bridge/complete` | Desktop `ctla_` key | Heartbeat + claim one meal; return its estimate |

Analysis accepts either `{ description }` (1–2,000 characters) or
`{ imageBase64, mediaType, context? }`. Mixed input is rejected. Both methods
use the saved personal Anthropic connector and never accept a caller API key.

Log payload: `food_name`, `calories`, `protein`, `carbs`, `fat`, optional `notes`,
`timestamp`, `image_url`, and `request_id`. The generated action requires all macros
and `request_id`. The endpoint accepts existing clients without a request id,
but those clients cannot benefit from retry protection. All nutrients must be
finite, non-negative numbers within the documented bounds. Timestamps must
include an explicit offset; omitted timestamps default to server time.

Nutrition API keys are random 192-bit secrets with only SHA-256 hashes persisted.
Revocation deletes the owner's key row. External writes derive `user_id` exclusively
from that key; any caller-supplied `user_id` or `id` is ignored. Native meal writes
use the browser's anon client with RLS and never send `user_id`.

For GPT retries, a deterministic UUID derived from the owner plus `request_id`
uses the existing primary-key constraint to make insertion atomic. Identical
retries return the original entry; changed values return 409. Native drafts keep
a UUID and timestamp for the same protection after an uncertain response.
If a meal is saved but the subsequent totals read fails, the response remains
`ok: true` with its entry id and `day_totals: null`, preventing needless re-logging.

Meal days use the owner's `ui_preferences.nutrition.timeZone`, including 23/25-hour
daylight-saving days. Save that preference before using the GPT (a server with no
saved preference uses UTC). The page refreshes when focused and every 20 seconds
while visible, so external uploads appear without a Realtime migration.

No new schema migration. Existing installations need the existing `api_keys`,
`nutrition_logs.notes`, `user_goals`, and `merge_ui_preferences` definitions from
`supabase-schema.sql`. Server prerequisites: Supabase URL, anon key and, for GPT
writes, `SUPABASE_SERVICE_ROLE_KEY`; photo analysis also needs an Anthropic key.

Verify with `node --test tests/nutrition.test.mjs`, the full project tests, a
production build, and a Worker dry run. Browser QA must use isolated fixtures,
without creating synthetic meals or keys in a real account.
