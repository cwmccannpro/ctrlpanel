// ============================================================
// CTRLpanel — Master Controller data layer
// Builds the account snapshot the model sees each turn, and executes the
// read/write tools it requests. Every call goes through the authenticated,
// RLS-scoped Supabase client, so the model can only ever touch the logged-in
// user's own rows.
// ============================================================
import { queryTable, insert, update, remove } from './supabase.js';
import { gcal, financeSheets } from './api.js';
import { financeSummary, financeAliases } from './financeSheet.js';
import { saveSessionContext } from './knowledge.js';
import { dayKey } from './helpers.js';

// Cache the Google-connection check briefly so calendar tools route to the
// same place the Calendar page reads (Google when connected, else Supabase).
let _gc = { at: 0, val: false };
async function isGoogleConnected() {
  if (Date.now() - _gc.at < 15000) return _gc.val;
  try {
    const s = await gcal.status();
    _gc = { at: Date.now(), val: !!s.connected };
  } catch {
    _gc = { at: Date.now(), val: false };
  }
  return _gc.val;
}

// Tables the Master Controller may read/write, with the text columns its
// `query_records` search scans. Anything not listed here is rejected.
export const TABLE_META = {
  knowledge_notes: { search: ['title','content','folder'], order: 'updated_at' },
  tasks: { search: ['title', 'description'], order: 'created_at' },
  boards: { search: ['name'], order: 'created_at' },
  projects: { search: ['name', 'description', 'goal', 'notes'], order: 'created_at' },
  crm_contacts: { search: ['business_name', 'email', 'phone', 'service', 'business_type', 'notes'], order: 'created_at' },
  crm_boards: { search: ['name'], order: 'created_at' },
  calendar_events: { search: ['title', 'calendar'], order: 'starts_at', ascending: true },
  nutrition_logs: { search: ['meal_name'], order: 'logged_at' },
  weight_logs: { search: [], order: 'logged_at' },
  user_goals: { search: [], order: 'updated_at' },
  supplements: { search: ['name', 'notes'], order: 'created_at' },
  supplement_logs: { search: [], order: 'taken_at' },
  fitness_schedule: { search: ['day_of_week', 'workout_type', 'notes'], order: 'day_of_week' },
  workout_logs: { search: ['workout_type', 'notes'], order: 'completed_at' },
  accounts: { search: ['name', 'type'], order: 'updated_at' },
  net_worth_snapshots: { search: [], order: 'snapshot_date' },
  income_sources: { search: ['name', 'type'], order: 'created_at' },
  expense_categories: { search: ['name', 'type'], order: 'created_at' },
  transactions: { search: ['note'], order: 'date' },
  holdings: { search: ['ticker', 'name', 'asset_class'], order: 'created_at' },
  portfolio_snapshots: { search: [], order: 'snapshot_date' },
  dividends: { search: [], order: 'paid_date' },
  habits: { search: ['name'], order: 'created_at' },
  habit_logs: { search: [], order: 'log_date' },
  opportunities: { search: ['title', 'org', 'industry', 'location', 'kind'], order: 'score' },
  industry_problems: { search: ['title', 'problem', 'industry', 'stage', 'who'], order: 'score' },
};

const isAllowed = (table) => Object.prototype.hasOwnProperty.call(TABLE_META, table);
// Opportunities are written by the Opportunities Agent run — the model may
// read them, never write them.
const READ_ONLY = new Set(['opportunities', 'industry_problems', 'knowledge_notes']); // Knowledge writes use version-checked save_context.
// Meal micronutrients come only from photo/text analysis (or the nutrition GPT), never from chat.
const MICROS_ERROR = 'Error: meal micronutrients are imported automatically from a meal photo or description and cannot be set here.';
const writesMealMicros = (table, values) => table === 'nutrition_logs' && values && Object.prototype.hasOwnProperty.call(values, 'micros');
const todayISO = () => dayKey(new Date());

/**
 * Compact, always-on awareness snapshot injected into the system prompt each
 * turn. Kept small on purpose — precise lookups use the query_records tool.
 */
export async function buildSnapshot(userName) {
  const snap = {
    user: userName,
    now: new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    today: todayISO(),
  };

  const safe = async (fn, fallback) => {
    try {
      const { data } = await fn();
      return data || fallback;
    } catch {
      return fallback;
    }
  };

  const [tasks, contacts, projects, habits] = await Promise.all([
    safe(() => queryTable('tasks', { order: 'due_date', ascending: true, limit: 40 }), []),
    safe(() => queryTable('crm_contacts', { order: 'created_at', limit: 60 }), []),
    safe(() => queryTable('projects', { order: 'created_at', limit: 30 }), []),
    safe(() => queryTable('habits', { order: 'created_at', limit: 40 }), []),
  ]);

  // Calendar awareness comes from Google when connected, else the local table.
  let events = [];
  try {
    if (await isGoogleConnected()) events = (await gcal.list()).events || [];
    else events = (await queryTable('calendar_events', { order: 'starts_at', ascending: true, limit: 25 })).data || [];
  } catch {
    events = [];
  }

  const openTasks = tasks.filter((t) => t.column_name !== 'Done');
  snap.tasks = {
    open_count: openTasks.length,
    items: openTasks.slice(0, 15).map((t) => ({ id: t.id, title: t.title, priority: t.priority, due_date: t.due_date, column: t.column_name })),
  };

  const upcoming = events.filter((e) => (e.starts_at || '') >= todayISO());
  snap.calendar = {
    upcoming_count: upcoming.length,
    items: upcoming.slice(0, 12).map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, calendar: e.calendar })),
  };

  snap.crm = {
    contact_count: contacts.length,
    contacts: contacts.slice(0, 40).map((c) => ({ id: c.id, name: c.business_name, temp: c.lead_temp, service: c.service })),
  };

  try {
    const workbook = await financeSheets.workbook();
    if (workbook.connected) {
      const s = financeSummary(workbook.data);
      snap.finance = { source: 'google_sheets', total_assets: s.assets, view: 'assets', available_cash: s.cash, planned_income: s.plannedIncome, planned_bills: s.plannedExpenses, planned_surplus: s.plannedSavings, unknown_balances: s.unknownBalances, accounts: (workbook.data.accounts || []).map(({ id, name, type, balance }) => ({ id, name, type, balance })) };
    } else snap.finance = { source: 'google_sheets', connected: false, note: 'Connect the Finance workbook to see current financial values.' };
  } catch (e) { snap.finance = { source: 'google_sheets', unavailable: true, error: e.message }; }

  snap.projects = projects.map((p) => ({ id: p.id, name: p.name, status: p.status }));
  snap.habits = habits.map((h) => ({ id: h.id, name: h.name }));

  // Top Opportunities Agent picks the user hasn't dismissed or applied to.
  try {
    const { data: opps } = await queryTable('opportunities', { order: 'score', ascending: false, limit: 25 });
    const picks = (opps || []).filter((o) => o.status === 'new' || o.status === 'saved').slice(0, 5);
    if (picks.length) {
      snap.opportunities = picks.map((o) => ({ id: o.id, title: o.title, org: o.org, kind: o.kind, score: o.score, deadline: o.deadline, status: o.status }));
    }
  } catch { /* opportunity awareness is optional */ }

  return snap;
}

/**
 * Execute one tool call the model requested. `navigate` routes the SPA;
 * `confirm(message)` returns a Promise<boolean> and is required before any
 * destructive (delete) action runs. Returns a short string the model reads.
 */
export async function executeTool(name, input = {}, { navigate, confirm } = {}) {
  try {
    if (['query_records', 'create_record', 'update_record', 'delete_record'].includes(name) && Object.hasOwn(financeAliases(), input.table)) {
      if (name !== 'query_records') return 'Finance is managed in Google Sheets. Open the Finance dashboard to edit values safely; legacy database finance rows are retained as historical data.';
      const workbook = await financeSheets.workbook();
      if (!workbook.connected) return 'Connect your finance workbook under Finance → Overview first.';
      let rows = financeAliases(workbook.data)[input.table];
      if (input.table === 'dividends') return 'Dividends are not part of this workbook contract. Log them as income transactions.';
      if (input.search) {
        const q = String(input.search).toLowerCase();
        rows = rows.filter((r) => (TABLE_META[input.table]?.search || []).some((key) => String(r[key] || '').toLowerCase().includes(q)));
      }
      for (const [key, value] of Object.entries(input.filters || {})) rows = rows.filter((r) => r[key] === value);
      return JSON.stringify(rows.slice(0, Math.min(Number(input.limit) || 25, 100)));
    }
    switch (name) {
      case 'save_context': return JSON.stringify({ok:true,note:await saveSessionContext(input)});
      case 'navigate_to': {
        const routes = {
          dashboard: '/', calendar: '/calendar', todo: '/todo', habits: '/habits',
          agents: '/agents', opportunities: '/agents/opportunities', industry: '/agents/industry-problems', projects: '/projects', crm: '/crm',
          health: '/health', nutrition: '/health#nutrition', supplements: '/health#supplements', fitness: '/health#fitness',
          networth: '/finance/networth', budget: '/finance/budget', investing: '/finance/investing',
          finance: '/finance', debt: '/finance',
          settings: '/settings', knowledge: '/knowledge',
        };
        const route = routes[String(input.page || '').toLowerCase()];
        if (!route) return `Unknown page: ${input.page}`;
        navigate?.(route);
        return `Navigated to ${input.page}.`;
      }

      case 'query_records': {
        const table = input.table;
        if (!isAllowed(table)) return `Error: "${table}" is not a queryable table.`;
        if (table === 'calendar_events' && (await isGoogleConnected())) {
          let events = (await gcal.list()).events || [];
          if (input.search) {
            const q = String(input.search).toLowerCase();
            events = events.filter((e) => (e.title || '').toLowerCase().includes(q));
          }
          return events.length ? JSON.stringify(events.slice(0, Math.min(Number(input.limit) || 25, 100))) : 'No matching events on Google Calendar.';
        }
        const meta = TABLE_META[table];
        const { data, error } = await queryTable(table, {
          search: input.search,
          searchColumns: meta.search,
          filters: input.filters || {},
          order: meta.order,
          ascending: meta.ascending || false,
          limit: Math.min(Number(input.limit) || 25, 100),
        });
        if (error) return `Error querying ${table}: ${error.message}`;
        if (!data.length) return `No matching rows in ${table}.`;
        return JSON.stringify(data);
      }

      case 'create_record': {
        const table = input.table;
        if (!isAllowed(table) || READ_ONLY.has(table)) return `Error: "${table}" is not a writable table.`;
        if (!input.values || typeof input.values !== 'object') return 'Error: values object required.';
        if (writesMealMicros(table, input.values)) return MICROS_ERROR;
        if (table === 'calendar_events' && (await isGoogleConnected())) {
          const v = input.values;
          if (!v.starts_at) return 'Error: starts_at (ISO timestamp) is required.';
          const ev = await gcal.create({ title: v.title || v.summary || 'Untitled', starts_at: v.starts_at, ends_at: v.ends_at, color: v.color });
          return `Created event on your Google Calendar: ${JSON.stringify(ev)}`;
        }
        const { data, error } = await insert(table, [input.values]);
        if (error) return `Error creating in ${table}: ${error.message}`;
        return `Created row in ${table}: ${JSON.stringify(data?.[0] || input.values)}`;
      }

      case 'update_record': {
        const table = input.table;
        if (!isAllowed(table) || READ_ONLY.has(table)) return `Error: "${table}" is not a writable table.`;
        if (!input.id) return 'Error: id required.';
        if (writesMealMicros(table, input.values)) return MICROS_ERROR;
        if (table === 'calendar_events' && (await isGoogleConnected())) {
          await gcal.update(input.id, input.values || {});
          return `Updated event on your Google Calendar.`;
        }
        const { data, error } = await update(table, input.id, input.values || {});
        if (error) return `Error updating ${table}: ${error.message}`;
        return `Updated ${table} row ${input.id}: ${JSON.stringify(data?.[0] || input.values)}`;
      }

      case 'delete_record': {
        const table = input.table;
        if (!isAllowed(table) || READ_ONLY.has(table)) return `Error: "${table}" is not a deletable table.`;
        if (!input.id) return 'Error: id required.';
        const ok = confirm
          ? await confirm(`Delete a row from ${table}? This can't be undone.`)
          : false;
        if (!ok) return 'User declined the deletion. Nothing was deleted.';
        if (table === 'calendar_events' && (await isGoogleConnected())) {
          await gcal.remove(input.id);
          return `Deleted event from your Google Calendar.`;
        }
        const { error } = await remove(table, input.id);
        if (error) return `Error deleting from ${table}: ${error.message}`;
        return `Deleted row ${input.id} from ${table}.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool error: ${err?.message || 'unknown'}`;
  }
}
