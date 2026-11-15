// Read-only iCalendar (.ics) feeds — client-side helpers.
// Feeds live in user_settings.ui_preferences.calendar.feeds as
// [{ id, label, url, color }]; the backend (backend/ical.js) fetches + parses.
// Kept import-free so `node --test` can load it.

export const MAX_FEEDS = 10;
// Curated for dark surfaces: bright enough to read as an accent, calm enough
// to sit next to each other in a dense week. An iCloud calendar's own colour
// maps onto the nearest of these (`nearestFeedColor`).
export const FEED_COLORS = ['#f43f5e', '#fb923c', '#fbbf24', '#34d399', '#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8'];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Nearest palette swatch to an arbitrary #rrggbb (perceptually weighted RGB distance).
export function nearestFeedColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const [r, g, b] = rgb(hex);
  let best = FEED_COLORS[0];
  let bestD = Infinity;
  for (const c of FEED_COLORS) {
    const [cr, cg, cb] = rgb(c);
    const rm = (r + cr) / 2;
    const d = (2 + rm / 256) * (r - cr) ** 2 + 4 * (g - cg) ** 2 + (2 + (255 - rm) / 256) * (b - cb) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// "webcal://…" is just https with another label. Returns { url } or { error }.
export function parseFeedUrl(input) {
  const raw = String(input || '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (!raw) return { error: 'Paste the calendar’s public link.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'That doesn’t look like a link.' };
  }
  if (u.protocol !== 'https:') return { error: 'The link must start with https:// or webcal://.' };
  return { url: u.toString() };
}

export const feedHost = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const feedName = (feed) => feed?.label || feedHost(feed?.url) || 'Calendar feed';

// Whatever is stored, hand back a clean list (ids unique, colours valid, capped).
export function sanitizeFeeds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (!f || typeof f.url !== 'string' || !f.url) continue;
    const id = typeof f.id === 'string' && f.id && !seen.has(f.id) ? f.id : `ical-${out.length + 1}-${Math.abs(hash(f.url)).toString(36)}`;
    seen.add(id);
    out.push({
      id,
      url: f.url,
      label: typeof f.label === 'string' ? f.label.trim().slice(0, 60) : '',
      color: /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : FEED_COLORS[out.length % FEED_COLORS.length],
    });
    if (out.length >= MAX_FEEDS) break;
  }
  return out;
}

export function makeFeed({ url, label, color: preferred }, existing = []) {
  const used = new Set(existing.map((f) => f.color));
  const color = nearestFeedColor(preferred) || FEED_COLORS.find((c) => !used.has(c)) || FEED_COLORS[existing.length % FEED_COLORS.length];
  return { id: `ical-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, url, label: String(label || '').trim().slice(0, 60), color };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
