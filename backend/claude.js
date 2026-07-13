// ============================================================
// CTRLpanel — all Claude API calls (per AGENTS.md rule #6).
// The Anthropic API key is read here on the backend and never
// exposed to the frontend.
// ============================================================
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6'; // per AGENTS.md tech stack

// Full Master Controller system prompt.
// {{USER}} is replaced per-request with the logged-in user's name.
const SYSTEM_PROMPT = `You are the Master Controller for CTRLpanel — a personal Life OS. You are assisting {{USER}}, and you have full read and write access to every module in this application through database tools.

## How you operate
You act on the user's own data through four tools: query_records (read), create_record (insert), update_record (edit), delete_record (remove), plus navigate_to. Every tool is scoped to this user's account only.

- To ANSWER questions about the user's data, first call query_records to get exact, current rows — never guess or invent data. A compact snapshot of the account is provided below for awareness, but treat it as a hint; query for specifics (e.g. finding a contact by name, or a task's id before updating it).
- To DO something (add a calendar event, create a task, update a balance, log an expense), call create_record / update_record with the correct table and column values.
- You may chain tools: e.g. query_records to find a contact's id, then update_record to change it. Take multiple steps as needed, then give a brief final confirmation.
- Dates/timestamps are ISO 8601. Interpret relative times ("2am tomorrow") against the current date/time in the snapshot and pass absolute ISO values.

## Tables and their key columns
- tasks: title, description, board_id, column_name (Backlog|In Progress|Review|Done), priority (Low|Medium|High|Urgent), due_date (date)
- projects: name, status (Active|Paused|Complete), description, goal, notes, color
- crm_contacts: business_name, phone, email, business_type, service, lead_temp (Cold|Warm|Hot), rating, times_called, last_touch (date), notes
- calendar_events: title, starts_at (timestamptz, required), ends_at, calendar, color
- nutrition_logs: meal_name, calories, protein, carbs, fat, logged_at
- weight_logs: weight (lbs), logged_at
- user_goals: calories, protein, carbs, fat
- supplements: name, dose, timing (Morning|Afternoon|Evening|Night), enabled, units_remaining, notes
- fitness_schedule: day_of_week, workout_type ; workout_logs: workout_type, completed_at, exercises, notes
- accounts: name, type (Checking|Savings|Investment|Crypto|Real Estate|Vehicle|Liability), balance
- income_sources: name, amount, frequency, type ; expense_categories: name, type (Fixed|Variable), budgeted ; transactions: amount, category_id, note, date
- holdings: ticker, name, asset_class (Stocks|ETFs|Crypto|Real Estate|Other), shares, avg_cost, manual_price ; dividends: holding_id, amount, paid_date
- agents: name, description, status (running|stopped) ; habits: name, active ; habit_logs: habit_id, log_date, completed
- Email triage (READ-ONLY — rows are written by the Email Triage agent): triage_runs: run_at, source, status, emails_scanned ; triage_items: run_id, account_alias, from_name, from_email, subject, category (needs_reply|client_lead|payments|ignore), summary, suggested_reply, draft_id. The snapshot includes the latest brief under email_triage; for questions like "what needs a reply today?" or "anything from clients?", query triage_items filtered by the latest run_id (and category). Approving drafts happens on the Mail Triage page (navigate_to "mail") — never modify triage rows.
Do NOT set user_id or id on create — the database fills those. Use ids returned from query_records for update/delete.

## Personality
- Direct and efficient — the user is busy, get to the point.
- Proactive — if you notice something worth flagging (budget over limit, agent stopped, supplements low), mention it briefly.
- Confident — make reasonable decisions and take action rather than asking unnecessary clarifying questions.
- Brief responses unless detail is requested.

## Rules
- Never expose API keys. Never fabricate financial or personal data — only report what query_records returns.
- delete_record asks the user for in-app confirmation before running; use it only when the user clearly wants something removed.
- After acting, confirm what you did in one sentence.`;

// Generic, table-driven tools. Executed client-side by the MasterController
// against the RLS-scoped Supabase client; the backend only relays requests
// and feeds tool results back into the model.
const TOOLS = [
  {
    name: 'navigate_to',
    description: 'Navigate the app to a page: dashboard, calendar, todo, habits, agents, projects, crm, nutrition, supplements, fitness, networth, budget, investing, mail (email triage brief), settings.',
    input_schema: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
  },
  {
    name: 'query_records',
    description: "Read the user's rows from a table. Use `search` for a case-insensitive text match (e.g. a contact name) and/or `filters` for exact-match columns. Returns matching rows as JSON, including their ids.",
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name, e.g. crm_contacts, tasks, calendar_events' },
        search: { type: 'string', description: 'Free-text to match against the table\'s text columns' },
        filters: { type: 'object', description: 'Exact-match column/value pairs, e.g. {"status":"running"}', additionalProperties: true },
        limit: { type: 'number' },
      },
      required: ['table'],
    },
  },
  {
    name: 'create_record',
    description: 'Insert a new row. Provide `table` and a `values` object of column/value pairs. Do not include id or user_id.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
      },
      required: ['table', 'values'],
    },
  },
  {
    name: 'update_record',
    description: 'Update an existing row by id. Provide `table`, `id` (from query_records), and a `values` object of the columns to change.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        id: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
      },
      required: ['table', 'id', 'values'],
    },
  },
  {
    name: 'delete_record',
    description: 'Delete a row by id. Requires the user to confirm in-app before it runs. Provide `table` and `id`.',
    input_schema: {
      type: 'object',
      properties: { table: { type: 'string' }, id: { type: 'string' } },
      required: ['table', 'id'],
    },
  },
];

let envClient = null;
// Per-user key (from the user's Settings connectors) takes precedence over the
// backend .env key. Per-user clients are not cached across requests.
function getClient(apiKey) {
  if (apiKey) return new Anthropic({ apiKey });
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!envClient) envClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return envClient;
}

const NO_KEY_MSG =
  'No Anthropic API key. Add one in Settings → Connectors, or set ANTHROPIC_API_KEY in the backend .env.';

/**
 * Stream one Master Controller turn as newline-delimited JSON. Emits:
 *   { type: 'text', text }                       — incremental assistant text
 *   { type: 'done', stop_reason, assistant }     — full assistant content blocks
 *   { type: 'error', message }
 * The frontend drives the agentic loop: when stop_reason === 'tool_use' it
 * executes the tool_use blocks against Supabase and calls back with results.
 */
// Transport-agnostic core: `write(obj)` emits one NDJSON event. Used by the
// Express route locally and the Cloudflare Worker in production, so both
// runtimes share one implementation.
export async function streamChatCore({ messages = [], context = {}, apiKey } = {}, write) {
  const anthropic = getClient(apiKey);
  if (!anthropic) {
    write({ type: 'error', message: NO_KEY_MSG });
    return;
  }

  const userName = context.user || 'the user';
  const system = `${SYSTEM_PROMPT.replace('{{USER}}', userName)}\n\n## Current Account Snapshot\n${JSON.stringify(context, null, 2)}`;

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: TOOLS,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        write({ type: 'text', text: event.delta.text });
      }
    }

    // Send the complete assistant message so the frontend can (a) record it in
    // history and (b) execute any tool_use blocks it contains.
    const final = await stream.finalMessage();
    write({ type: 'done', stop_reason: final.stop_reason, assistant: final.content });
  } catch (err) {
    write({ type: 'error', message: err?.message || 'Claude API error' });
  }
}

// Express wrapper around the core (local dev server).
export async function streamChat(res, params = {}) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const write = (obj) => res.write(JSON.stringify(obj) + '\n');
  try {
    await streamChatCore(params, write);
  } finally {
    res.end();
  }
}

// Non-streaming helper used by the supplement/interaction routes.
async function complete(system, prompt, maxTokens = 1024, apiKey) {
  const anthropic = getClient(apiKey);
  if (!anthropic) throw new Error(NO_KEY_MSG);
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function supplementAnalyze({ supplements = [], apiKey }) {
  const system =
    'You are a supplement and nutrition expert. Analyze the stack for interactions, redundancies, timing optimizations, and insights. Use clear sections with short bullet points. Be precise; do not give medical advice beyond general guidance.';
  const prompt = `Analyze this supplement stack:\n${JSON.stringify(supplements, null, 2)}`;
  return { result: await complete(system, prompt, 1500, apiKey) };
}

export async function interactionCheck({ a, b, apiKey }) {
  const system =
    'You are a pharmacology expert. Given two supplements or drugs, describe any known interactions, severity, and timing guidance in a short, clear analysis. Note when to consult a professional.';
  const prompt = `Check the interaction between "${a}" and "${b}".`;
  return { result: await complete(system, prompt, 1000, apiKey) };
}

/* ---- Email Triage (headless — used by backend/gmail.js) ------------------
   Categorizes a batch of unread emails from ONE Gmail account and drafts
   suggested replies for the ones that need one. Output is forced through a
   tool so it always comes back as structured JSON. Nothing here sends mail —
   suggested replies are text stored with the triage result. */
const TRIAGE_TOOL = {
  name: 'submit_triage',
  description: 'Submit the triage verdict for every email in the batch.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The Gmail message id, exactly as given' },
            category: { type: 'string', enum: ['needs_reply', 'client_lead', 'payments', 'ignore'] },
            summary: { type: 'string', description: 'One line: who/what/why it matters' },
            suggested_reply: { type: 'string', description: 'Draft reply text — ONLY for needs_reply items' },
          },
          required: ['id', 'category', 'summary'],
        },
      },
    },
    required: ['items'],
  },
};

const TRIAGE_SYSTEM = `You are the email-triage step of CTRLpanel's Master Controller. You receive unread emails (metadata + snippet) from one of the user's Gmail accounts and must categorize EVERY one:

- needs_reply: a real person is waiting on the user (questions, requests, follow-ups, scheduling). Write a suggested reply.
- client_lead: client or sales-lead activity worth knowing about but not necessarily replying to (new inquiry confirmations, project updates, prospect opens).
- payments: invoices, receipts, payouts, billing, subscription charges, banking alerts.
- ignore: newsletters, promotions, notifications, spam, anything not worth the user's time.

Rules:
- Return a verdict for every id you were given, each exactly once.
- summary is ONE tight line (max ~15 words), specific enough to act on without opening the email.
- suggested_reply only for needs_reply: short, friendly-professional, in the user's voice, ready to lightly edit and send. No subject line, no signature block beyond a simple sign-off with the user's first name. You only see snippets, so keep replies safe: acknowledge, answer what is clear, and ask for specifics rather than inventing details.
- Never fabricate facts, prices, or commitments the snippet does not support.`;

export async function triageCategorize({ alias, email, messages = [], userName, apiKey }) {
  const anthropic = getClient(apiKey);
  if (!anthropic) throw new Error(NO_KEY_MSG);
  if (!messages.length) return {};

  const payload = messages.map((m) => ({
    id: m.gmail_message_id,
    from: `${m.from_name || ''} <${m.from_email || ''}>`.trim(),
    subject: m.subject || '(no subject)',
    received_at: m.received_at,
    snippet: m.snippet || '',
  }));

  const prompt =
    `User: ${userName || 'the user'}\nAccount: "${alias}" (${email || 'unknown address'})\n` +
    `Unread emails from the last 24h (${payload.length}):\n${JSON.stringify(payload, null, 2)}\n\n` +
    'Triage every email via submit_triage.';

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: TRIAGE_SYSTEM,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_triage' },
    messages: [{ role: 'user', content: prompt }],
  });

  const call = msg.content.find((b) => b.type === 'tool_use' && b.name === 'submit_triage');
  const items = Array.isArray(call?.input?.items) ? call.input.items : [];
  const byId = {};
  for (const it of items) {
    if (it?.id) byId[it.id] = it;
  }
  return byId;
}
