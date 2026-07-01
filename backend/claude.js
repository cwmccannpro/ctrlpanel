// ============================================================
// CTRLpanel — all Claude API calls (per AGENTS.md rule #6).
// The Anthropic API key is read here on the backend and never
// exposed to the frontend.
// ============================================================
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6'; // per AGENTS.md tech stack

// Full Master Controller system prompt (MASTER_CONTROLLER_PROMPT.md).
// {{USER}} is replaced per-request with the logged-in user's name.
const SYSTEM_PROMPT = `You are the Master Controller for CTRLpanel — a personal Life OS. You are assisting {{USER}}, and you have full read and write access to every module in this application.

## Your Capabilities
You can read data from and write data to these modules:
- Dashboard — summarize the day, show stats
- Calendar — read events, create events, update events
- To Do / Kanban — create tasks, move tasks between columns, mark complete, list tasks
- Agents — toggle agents on/off, show agent status
- Projects — show project status, add projects, update project info
- CRM — add contacts, update contacts, query contacts, log calls, update lead temperature
- Nutrition — log weight, summarize macros, show meal history
- Supplements — show stack, analyze interactions, toggle supplements
- Fitness — log workouts, show schedule, show streak
- Net Worth — show current net worth, add accounts, update balances, save snapshot
- Budget — log expenses, show spending by category, show remaining budget
- Investing — show portfolio, show gain/loss, show allocation

## Tools Available
You have function tools. Use them when the user asks you to DO something, not just explain:
- navigate_to(page) — navigate to any page: dashboard, calendar, todo, agents, projects, crm, nutrition, supplements, fitness, networth, budget, investing, settings
- create_task(title, board, priority, due_date, project)
- move_task(task_id, column) — Backlog / In Progress / Review / Done
- log_expense(amount, category, note, date)
- log_weight(weight, date) — in lbs
- add_crm_contact(business_name, phone, email, service, lead_temp)
- get_summary(module)
- toggle_agent(agent_name, status)

## Personality
- Direct and efficient — the user is busy, get to the point
- Proactive — if you notice something (budget over limit, agent down, supplements running low) mention it
- Personal — reference the user's context naturally
- Confident — make decisions and take actions, don't ask unnecessary clarifying questions
- Brief responses unless detail is asked for

## Response Format
- For simple actions: confirm what you did in one sentence
- For summaries: use short bullet points, never long paragraphs
- For analysis (supplements, finances): use clear sections with headers
- Always call the appropriate tool when the user asks you to do something

## Never Do
- Never expose API keys
- Never make up financial data — only report what's in the database
- Never delete data without explicit confirmation from Cameron
- Never be verbose when brief will do`;

// Tool definitions (AGENTS.md). These are executed client-side by the
// MasterController; the backend only relays the tool_use request.
const TOOLS = [
  {
    name: 'navigate_to',
    description: 'Navigate to a page in the app',
    input_schema: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
  },
  {
    name: 'create_task',
    description: 'Create a new task',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        board: { type: 'string' },
        priority: { type: 'string' },
        due_date: { type: 'string' },
        project: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'move_task',
    description: 'Move a task to a different column',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, column: { type: 'string' } },
      required: ['task_id', 'column'],
    },
  },
  {
    name: 'log_expense',
    description: 'Log a financial transaction',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        category: { type: 'string' },
        note: { type: 'string' },
        date: { type: 'string' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'log_weight',
    description: 'Log a weight entry in lbs',
    input_schema: {
      type: 'object',
      properties: { weight: { type: 'number' }, date: { type: 'string' } },
      required: ['weight'],
    },
  },
  {
    name: 'add_crm_contact',
    description: 'Add a CRM contact',
    input_schema: {
      type: 'object',
      properties: {
        business_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        service: { type: 'string' },
        lead_temp: { type: 'string' },
      },
      required: ['business_name'],
    },
  },
  {
    name: 'get_summary',
    description: "Get a summary of a module's current data",
    input_schema: { type: 'object', properties: { module: { type: 'string' } }, required: ['module'] },
  },
  {
    name: 'toggle_agent',
    description: 'Turn an agent on or off',
    input_schema: {
      type: 'object',
      properties: { agent_name: { type: 'string' }, status: { type: 'string' } },
      required: ['agent_name', 'status'],
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
 * Stream a Master Controller chat turn as newline-delimited JSON.
 * Emits { type: 'text', text }, { type: 'tool_use', name, input },
 * { type: 'done' }, and { type: 'error', message }.
 */
export async function streamChat(res, { messages = [], context = {}, apiKey } = {}) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const write = (obj) => res.write(JSON.stringify(obj) + '\n');

  const anthropic = getClient(apiKey);
  if (!anthropic) {
    write({ type: 'error', message: NO_KEY_MSG });
    return res.end();
  }

  const userName = context.user || 'the user';
  const system = `${SYSTEM_PROMPT.replace('{{USER}}', userName)}\n\n## Current Context Snapshot\n${JSON.stringify(context, null, 2)}`;

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

    // Tool calls arrive complete on the final message.
    const final = await stream.finalMessage();
    for (const block of final.content) {
      if (block.type === 'tool_use') {
        write({ type: 'tool_use', name: block.name, input: block.input });
      }
    }
    write({ type: 'done' });
  } catch (err) {
    write({ type: 'error', message: err?.message || 'Claude API error' });
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
