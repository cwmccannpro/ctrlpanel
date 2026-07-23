// ============================================================
// CTRLpanel — Master Controller data layer
// Builds the account snapshot the model sees each turn, and executes the
// read/write tools it requests. Every call goes through the authenticated,
// RLS-scoped Supabase client, so the model can only ever touch the logged-in
// user's own rows.
// ============================================================
import { queryTable, insert, update, remove } from './supabase.js';
import { gcal } from './api.js';

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
  fitness_schedule: { search: ['day_of_week', 'workout_type'], order: 'day_of_week' },
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
  report_sources: { search: ['name'], order: 'created_at' },
  reports: { search: ['title'], order: 'received_at' },
};

const isAllowed = (table) => Object.prototype.hasOwnProperty.call(TABLE_META, table);
// Inbound PDF reports are written by the backend on ingest — the model may
// read the metadata, never write it (and it can't read the PDF contents).
const READ_ONLY = new Set(['report_sources', 'reports']);
const todayISO = () => new Date().toISOString().slice(0, 10);

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

  const [tasks, contacts, accounts, projects, habits] = await Promise.all([
    safe(() => queryTable('tasks', { order: 'due_date', ascending: true, limit: 40 }), []),
    safe(() => queryTable('crm_contacts', { order: 'created_at', limit: 60 }), []),
    safe(() => queryTable('accounts', { order: 'updated_at', limit: 40 }), []),
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

  const netWorth = accounts.reduce((s, a) => s + (a.type === 'Liability' ? -Number(a.balance || 0) : Number(a.balance || 0)), 0);
  snap.finance = {
    net_worth: netWorth,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: Number(a.balance || 0) })),
  };

  snap.projects = projects.map((p) => ({ id: p.id, name: p.name, status: p.status }));
  snap.habits = habits.map((h) => ({ id: h.id, name: h.name }));

  // Recent inbound PDF reports (metadata only — the model can't read the PDFs).
  try {
    const { data: reports } = await queryTable('reports', { order: 'received_at', ascending: false, limit: 10 });
    if (reports?.length) {
      snap.reports = reports.map((r) => ({ id: r.id, source_id: r.source_id, title: r.title, received_at: r.received_at }));
    }
  } catch { /* report awareness is optional */ }

  return snap;
}

/**
 * Execute one tool call the model requested. `navigate` routes the SPA;
 * `confirm(message)` returns a Promise<boolean> and is required before any
 * destructive (delete) action runs. Returns a short string the model reads.
 */
export async function executeTool(name, input = {}, { navigate, confirm } = {}) {
  try {
    switch (name) {
      case 'navigate_to': {
        const routes = {
          dashboard: '/', calendar: '/calendar', todo: '/todo', habits: '/habits',
          reports: '/reports', projects: '/projects', crm: '/crm',
          nutrition: '/health/nutrition', supplements: '/health/supplements', fitness: '/health/fitness',
          networth: '/finance/networth', budget: '/finance/budget', investing: '/finance/investing',
          settings: '/settings',
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
