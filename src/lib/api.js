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
};

// Session-authenticated requests (sharing, invites, nutrition social) — the
// backend verifies the Supabase access token to know who's asking.
async function authRequest(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `API ${res.status}`);
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

// Gmail Email Triage — multi-account connect + triage actions. Accounts are
// managed server-side (tokens never reach the browser); the brief itself
// (triage_runs / triage_items) is read via the RLS-scoped Supabase client.
export const gmail = {
  status: () => authApi.get('/gmail/status'),
  connect: async (alias) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    window.location.href = `${BASE}/gmail/connect?alias=${encodeURIComponent(alias)}&token=${encodeURIComponent(token)}`;
  },
  disconnect: (accountId) => authApi.post('/gmail/disconnect', { account_id: accountId }),
  runNow: () => authApi.post('/gmail/run'),
  createDraft: (itemId) => authApi.post('/gmail/draft', { item_id: itemId }),
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
