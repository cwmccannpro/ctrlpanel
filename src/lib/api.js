// ============================================================
// CTRLpanel — fetch helpers for the Express backend (/api/*)
// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.js).
// ============================================================

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

export const calendar = {
  events: () => api.get('/calendar/events'),
  create: (event) => api.post('/calendar/events', event),
};
