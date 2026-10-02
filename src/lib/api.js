// ============================================================
// CTRLpanel — fetch helpers for the Express backend (/api/*)
// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.js).
// ============================================================
import { supabase } from './supabase.js';

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
};

/**
 * Stream a Master Controller chat turn from the backend.
 * The backend forwards Claude's stream as newline-delimited JSON events:
 *   { type: 'text', text }            — incremental assistant text
 *   { type: 'tool_use', name, input } — a tool the frontend should execute
 *   { type: 'done' }                  — turn finished
 *   { type: 'error', message }        — failure
 *
 * onEvent(event) is called for each parsed event.
 */
export async function streamChat({ messages, context, apiKey }, onEvent, signal) {
  const res = await fetch(`${BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context, apiKey }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    onEvent({ type: 'error', message: `API ${res.status}: ${text}` });
    return;
  }
  await readNdjson(res, onEvent);
}

// Parse a newline-delimited JSON response body, calling onEvent per line.
async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {
        /* ignore partial / malformed lines */
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()));
    } catch {
      /* ignore */
    }
  }
}

// Convenience wrappers for backend routes used across pages.
export const finance = {
  prices: (tickers) => api.get(`/finance/prices?tickers=${encodeURIComponent(tickers.join(','))}`),
  // One symbol's historical chart series (for a holding's detail view).
  history: (ticker, scale) => api.get(`/finance/history?ticker=${encodeURIComponent(ticker)}&scale=${encodeURIComponent(scale)}`),
  // The portfolio's real value over time, reconstructed from holdings' history.
  portfolioHistory: (holdings, scale) => api.post('/finance/portfolio-history', { holdings, scale }),
};

// Session-authenticated requests. The backend verifies the Supabase access
// token to know which private workspace is making the request.
async function authRequest(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `code` / `status` let callers tell "sheet not shared" from "API down" without parsing text.
    const err = new Error(body?.error || `API ${res.status}`);
    err.code = body?.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

export const authApi = {
  get: (path) => authRequest(path),
  post: (path, body) => authRequest(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  del: (path) => authRequest(path, { method: 'DELETE' }),
};

// Google Calendar — authenticated with the current Supabase session so the
// backend knows which user's calendar to act on.
async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function gfetch(path, options = {}) {
  const res = await fetch(`${BASE}/calendar${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.text().catch(() => res.statusText)) || `API ${res.status}`);
  return res.json();
}

// YouTube analytics — per-user OAuth managed server-side (tokens never reach
// the browser). Channel metadata + analytics come back through these calls.
export const youtube = {
  status: () => authApi.get('/youtube/status'),
  connect: async () => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    window.location.href = `${BASE}/youtube/connect?token=${encodeURIComponent(token)}`;
  },
  analytics: (id, range) => authApi.get(`/youtube/analytics?id=${encodeURIComponent(id)}&range=${encodeURIComponent(range)}`),
  rename: (id, label) => authApi.post('/youtube/rename', { id, label }),
  disconnect: (id) => authApi.post('/youtube/disconnect', { id }),
};

// Google Sheets-backed CRM. The server authenticates with a service account,
// so there's no user OAuth — the user shares their spreadsheet with the
// service account address that /status returns.
export const sheets = {
  status: () => authApi.get('/sheets/status'),
  check: () => authApi.get('/sheets/check'),
  meta: (id) => authApi.get(`/sheets/meta?id=${encodeURIComponent(id)}`),
  values: (id, sheet) => authApi.get(`/sheets/values?id=${encodeURIComponent(id)}&sheet=${encodeURIComponent(sheet)}`),
  setCell: (id, sheet, row, col, value) => authApi.post('/sheets/cell', { id, sheet, row, col, value }),
  append: (id, sheet, values) => authApi.post('/sheets/append', { id, sheet, values }),
  deleteRows: (id, sheetId, rows) => authApi.post('/sheets/delete-rows', { id, sheetId, rows }),
};

// Agents folder. The Opportunities run streams NDJSON progress events
// (start / search / results / status / ping / done / error) — see
// backend/opportunities.js. The server reads the user's config itself.
export const agentsApi = {
  async runOpportunities({ apiKey, today } = {}, onEvent, signal) {
    const res = await fetch(`${BASE}/agents/opportunities/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ apiKey, today }),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      onEvent({ type: 'error', message: body?.error || `API ${res.status}` });
      return;
    }
    await readNdjson(res, onEvent);
  },
  extractProfile: (pdfBase64, apiKey) => authApi.post('/agents/opportunities/profile', { pdfBase64, apiKey }),
};

export const gcal = {
  status: () => gfetch('/status'),
  connect: async () => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    window.location.href = `${BASE}/calendar/connect?token=${encodeURIComponent(token)}`;
  },
  disconnect: () => gfetch('/disconnect', { method: 'POST' }),
  calendars: () => gfetch('/calendars'),
  list: (params = {}) => gfetch(`/events?${new URLSearchParams(params).toString()}`),
  create: (ev) => gfetch('/events', { method: 'POST', body: JSON.stringify(ev) }),
  update: (id, ev) => gfetch(`/events/${encodeURIComponent(id)}?calendarId=${encodeURIComponent(ev.cal_id || 'primary')}`, { method: 'PATCH', body: JSON.stringify(ev) }),
  remove: (id, calId = 'primary') => gfetch(`/events/${encodeURIComponent(id)}?calendarId=${encodeURIComponent(calId)}`, { method: 'DELETE' }),
};
