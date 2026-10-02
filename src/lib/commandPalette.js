// Pure helpers for the Ctrl+K command palette. Only imports ./helpers.js (itself
// import-free), so `node --test` can load this without a bundler or Supabase.
import { dayKey } from './helpers.js';
export { dayKey };

const PRIORITY_TOKENS = {
  urgent: 'Urgent', u: 'Urgent',
  high: 'High', h: 'High',
  medium: 'Medium', med: 'Medium', m: 'Medium',
  low: 'Low', l: 'Low',
};

const WEEKDAYS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function addDays(base, days) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

// Returns a Date for a real calendar day, or null (rejects 2026-02-31 etc.).
function realDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** Parse the value after "@" in a capture, e.g. "fri", "tomorrow", "3d", "9/14". */
function parseDue(raw, now) {
  const v = raw.toLowerCase();
  if (v === 'today' || v === 'tod') return dayKey(now);
  if (v === 'tomorrow' || v === 'tmr' || v === 'tmrw') return dayKey(addDays(now, 1));

  if (v in WEEKDAYS) {
    // Next occurrence, never today: "@fri" typed on a Friday means next Friday.
    const ahead = ((WEEKDAYS[v] - now.getDay() + 7) % 7) || 7;
    return dayKey(addDays(now, ahead));
  }

  let m = v.match(/^\+?(\d{1,3})([dw])$/);
  if (m) return dayKey(addDays(now, Number(m[1]) * (m[2] === 'w' ? 7 : 1)));

  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const date = realDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? dayKey(date) : null;
  }

  m = v.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    let date = realDate(now.getFullYear(), Number(m[1]), Number(m[2]));
    // A date that already passed this year means next year's.
    if (date && dayKey(date) < dayKey(now)) date = realDate(now.getFullYear() + 1, Number(m[1]), Number(m[2]));
    return date ? dayKey(date) : null;
  }
  return null;
}

/**
 * Split a quick-capture line into a task: "Call dentist @fri !high" →
 * { title: 'Call dentist', priority: 'High', due: '2026-10-02' }.
 * Only whole space-separated tokens count, so "50%!high" or an email address
 * stay part of the title. `priority` is null when none was given.
 */
export function parseCapture(input, now = new Date()) {
  const kept = [];
  let priority = null;
  let due = null;
  for (const word of String(input || '').trim().split(/\s+/).filter(Boolean)) {
    if (word.length > 1 && word[0] === '!' && word.slice(1).toLowerCase() in PRIORITY_TOKENS) {
      priority = PRIORITY_TOKENS[word.slice(1).toLowerCase()];
    } else if (word.length > 1 && word[0] === '@' && parseDue(word.slice(1), now)) {
      due = parseDue(word.slice(1), now);
    } else {
      kept.push(word);
    }
  }
  return { title: kept.join(' '), priority, due };
}

/** "Today" / "Tomorrow" / "Fri, Oct 2" for a YYYY-MM-DD key, read as a local day. */
export function formatDue(key, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return '';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const diff = Math.round((date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Board that quick captures (palette + Today panel) land on by default.
const CAPTURE_BOARD_KEY = 'ctrlpanel-capture-board';
export function readCaptureBoard() {
  try {
    return JSON.parse(localStorage.getItem(CAPTURE_BOARD_KEY));
  } catch {
    return null;
  }
}
export function writeCaptureBoard(id) {
  try {
    localStorage.setItem(CAPTURE_BOARD_KEY, JSON.stringify(id));
  } catch { /* private mode / quota: a convenience only */ }
}

/** A `tasks` row from a parsed capture. `board` may be null (the task then shows under "All Boards"). */
export function taskRowFromCapture(capture, board, defaultDue = null) {
  return {
    title: capture.title,
    board_id: board?.id || null,
    column_name: board?.columns?.[0] || 'Backlog',
    priority: capture.priority || 'Medium',
    due_date: capture.due || defaultDue,
  };
}

/** The column that means "finished" on a board: one named Done, else its last column. */
export function doneColumn(board) {
  const cols = Array.isArray(board?.columns) ? board.columns : [];
  return cols.find((c) => /^done$/i.test(String(c).trim())) || cols.at(-1) || 'Done';
}

const norm = (s) => String(s || '').toLowerCase().trim();

function scoreTerm(term, text, loose) {
  if (text === term) return 100;
  if (text.startsWith(term)) return 90;
  const at = text.indexOf(term);
  if (at > 0) {
    // Start of a later word beats a match in the middle of one.
    return /[^a-z0-9]/.test(text[at - 1]) ? 70 : 50;
  }
  if (loose && term.length >= 3) {
    // Loose subsequence: "ntwrth" still finds "net worth".
    let i = 0;
    for (const ch of text) if (ch === term[i]) i++;
    if (i === term.length) return 15;
  }
  return 0;
}

/**
 * 0 = no match; higher is better. Every space-separated term must match.
 * `loose` allows the "ntwrth" → "net worth" subsequence fallback (labels only:
 * on long text it matches nearly anything).
 */
export function scoreMatch(query, text, { loose = true } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const hay = norm(text);
  if (!terms.length) return 1;
  let total = 0;
  for (const term of terms) {
    const s = scoreTerm(term, hay, loose);
    if (!s) return 0;
    total += s;
  }
  return total / terms.length;
}

/**
 * Rank palette items against a query. Items are `{ label, keywords?, ... }`.
 * With an empty query everything is returned in its original order.
 */
export function rankItems(items, query) {
  if (!norm(query)) return items.map((item, index) => ({ item, score: 0, index }));
  const out = [];
  items.forEach((item, index) => {
    const own = scoreMatch(query, item.label);
    const alt = item.keywords ? scoreMatch(query, item.keywords, { loose: false }) * 0.6 : 0;
    const score = Math.max(own, alt);
    if (score > 0) out.push({ item, score, index });
  });
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Pages reachable from anywhere. Dynamic items (projects, boards…) are added by the palette. */
export const PAGES = [
  { label: 'Dashboard', to: '/', icon: 'ti-layout-dashboard', keywords: 'home overview today' },
  { label: 'Calendar', to: '/calendar', icon: 'ti-calendar', keywords: 'schedule events agenda' },
  { label: 'To Do', to: '/todo', icon: 'ti-checkbox', keywords: 'tasks kanban board' },
  { label: 'Knowledge Base', to: '/knowledge', icon: 'ti-notebook', keywords: 'notes docs wiki' },
  { label: 'Habits', to: '/habits', icon: 'ti-repeat', keywords: 'streak routine tracker' },
  { label: 'Weekly Review', to: '/review', icon: 'ti-report', keywords: 'week summary reflect retrospective stats wins lessons' },
  { label: 'Projects', to: '/projects', icon: 'ti-folder', keywords: 'overview manage' },
  { label: 'CRM', to: '/crm', icon: 'ti-users', keywords: 'contacts people pages' },
  { label: 'Agents', to: '/agents', icon: 'ti-robot', keywords: 'ai opportunities' },
  { label: 'Nutrition', to: '/health/nutrition', icon: 'ti-heart', keywords: 'health food calories macros' },
  { label: 'Supplements', to: '/health/supplements', icon: 'ti-heart', keywords: 'health stack' },
  { label: 'Fitness', to: '/health/fitness', icon: 'ti-heart', keywords: 'health workout training' },
  { label: 'Net Worth', to: '/finance/networth', icon: 'ti-coin', keywords: 'finance accounts assets' },
  { label: 'Budget', to: '/finance/budget', icon: 'ti-coin', keywords: 'finance spending income' },
  { label: 'Investing', to: '/finance/investing', icon: 'ti-coin', keywords: 'finance portfolio stocks holdings' },
  { label: 'Socials', to: '/socials', icon: 'ti-share', keywords: 'youtube channels' },
  { label: 'Settings', to: '/settings', icon: 'ti-settings', keywords: 'accent profile connectors api keys' },
];
