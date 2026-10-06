// ============================================================
// CTRLpanel — read-only iCalendar (.ics) feeds
//
// A feed is just a URL (iCloud "Public Calendar" link, Outlook/Fastmail
// publish link, any webcal://). The browser can't fetch them (no CORS), so
// the backend downloads + parses on request and returns events in the same
// shape as backend/google.js (`starts_at`, `ends_at`, `all_day`, `color` …).
//
// Nothing is stored server-side: the feed list lives in the user's own
// `user_settings.ui_preferences.calendar.feeds` (RLS-scoped) and is sent with
// each request over the Supabase-authenticated session.
//
// Workers-compatible: plain fetch + Intl only (no Node-only packages).
// ============================================================

const DAY = 86400000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FEEDS = 10;
const MAX_RANGE_DAYS = 400;
const MAX_EVENTS_PER_FEED = 3000;
const FETCH_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_COLOR = '#3b82f6';

/* ---------------- URL safety ---------------- */

export class IcalError extends Error {
  constructor(message, code = 'ical_error') {
    super(message);
    this.code = code;
  }
}

// webcal(s):// is just https:// with a different scheme label.
export function normalizeFeedUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new IcalError('Paste a calendar feed URL.', 'bad_url');
  raw = raw.replace(/^webcals?:\/\//i, 'https://');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new IcalError('That doesn’t look like a URL.', 'bad_url');
  }
  assertPublicUrl(u);
  return u.toString();
}

// The server fetches whatever URL it is given, so refuse anything that isn't a
// public https host (no credentials, IP literals, localhost or internal names).
function assertPublicUrl(u) {
  if (u.protocol !== 'https:') throw new IcalError('Feed URLs must be https:// or webcal://.', 'bad_url');
  if (u.username || u.password) throw new IcalError('Feed URLs can’t contain a username or password.', 'bad_url');
  const host = u.hostname.toLowerCase();
  const bad =
    !host ||
    !host.includes('.') ||
    host.startsWith('[') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host === 'localhost' ||
    /\.(localhost|local|internal|lan|home|test|invalid|corp)$/.test(host);
  if (bad) throw new IcalError('That host isn’t allowed for a calendar feed.', 'bad_url');
}

/* ---------------- fetching ---------------- */

const cache = new Map(); // url → { at, text }

async function readCapped(res) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new IcalError('That feed is too large.', 'too_large');
  if (!res.body?.getReader) {
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new IcalError('That feed is too large.', 'too_large');
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new IcalError('That feed is too large.', 'too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchIcs(feedUrl) {
  let url = normalizeFeedUrl(feedUrl);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  const key = url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop < 5; hop++) {
      let res;
      try {
        res = await fetch(url, {
          redirect: 'manual',
          signal: ctl.signal,
          headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'CTRLpanel-ical/1.0' },
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw new IcalError('The feed took too long to respond.', 'timeout');
        throw new IcalError('Couldn’t reach that feed.', 'unreachable');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new IcalError('The feed redirected without a destination.', 'bad_response');
        // Re-validate every hop so a redirect can't point at an internal host.
        url = normalizeFeedUrl(new URL(loc, url).toString().replace(/^http:\/\//i, 'https://'));
        continue;
      }
      if (res.status === 404 || res.status === 410) throw new IcalError('That feed link no longer exists (404). Re-share the calendar for a fresh link.', 'not_found');
      if (res.status === 401 || res.status === 403) throw new IcalError('That feed isn’t public. Make the calendar public, then copy its link.', 'forbidden');
      if (!res.ok) throw new IcalError(`The feed returned HTTP ${res.status}.`, 'bad_response');
      const text = await readCapped(res);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcalError('That URL didn’t return a calendar (.ics) feed.', 'not_ics');
      if (cache.size > 20) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), text });
      return text;
    }
    throw new IcalError('The feed redirected too many times.', 'bad_response');
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- iCalendar parsing ---------------- */

const unfold = (text) => String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');

function parseLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":value — the first ':' outside quotes splits.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = [];
  let cur = '';
  inQuote = false;
  for (const c of head) {
    if (c === '"') { inQuote = !inQuote; cur += c; }
    else if (c === ';' && !inQuote) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  parts.push(cur);
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

const unescapeText = (s) =>
  String(s).replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// Returns the VEVENTs of a feed as { PROP: [{ params, value }] } maps, plus the calendar name.
export function parseIcs(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let calName = '';
  let calColor = '';
  let cur = null;
  let depth = 0; // nested components inside a VEVENT (VALARM) are ignored
  for (const raw of lines) {
    if (!raw) continue;
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === 'BEGIN') {
      if (cur) depth++;
      else if (l.value.toUpperCase() === 'VEVENT') cur = {};
      continue;
    }
    if (l.name === 'END') {
      if (cur && depth > 0) depth--;
      else if (cur && l.value.toUpperCase() === 'VEVENT') { events.push(cur); cur = null; }
      continue;
    }
    if (cur) {
      if (depth) continue;
      (cur[l.name] ||= []).push({ params: l.params, value: l.value });
    } else if (l.name === 'X-WR-CALNAME' && !calName) {
      calName = unescapeText(l.value);
    } else if ((l.name === 'X-APPLE-CALENDAR-COLOR' || l.name === 'X-OUTLOOK-COLOR' || l.name === 'COLOR') && !calColor) {
      // iCloud sends #RRGGBB or #RRGGBBAA; keep the RGB part.
      const m = /^#([0-9a-f]{6})/i.exec(l.value.trim());
      if (m) calColor = `#${m[1].toLowerCase()}`;
    }
  }
  return { events, calName, calColor };
}

/* ---------------- time zones ---------------- */

const WINDOWS_TZ = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC',
};

const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
    } catch {
      f = null;
    }
    fmtCache.set(tz, f);
  }
  return f;
}

// An IANA name Intl understands, or null (custom VTIMEZONE ids, typos).
export function resolveTz(tzid) {
  if (!tzid) return null;
  const candidates = [tzid, WINDOWS_TZ[tzid]];
  if (tzid.startsWith('/')) {
    const seg = tzid.split('/').filter(Boolean);
    candidates.push(seg.slice(-2).join('/'), seg.slice(-1)[0]);
  }
  return candidates.find((c) => c && formatter(c)) || null;
}

function tzOffset(ms, tz) {
  const parts = formatter(tz).formatToParts(new Date(Math.floor(ms / 1000) * 1000));
  const v = {};
  for (const p of parts) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(ms / 1000) * 1000;
}

// "Naive" ms = wall-clock components read as if they were UTC.
export function naiveToInstant(naive, tz) {
  if (!tz || tz === 'UTC') return naive;
  const guess = naive - tzOffset(naive, tz);
  return naive - tzOffset(guess, tz);
}

/* ---------------- value parsing ---------------- */

// → { naive, dateOnly, utc, tz }  (tz = resolved IANA name for zoned values)
function parseDateValue(prop, fallbackTz) {
  if (!prop) return null;
  const v = String(prop.value).trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(v);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const dateOnly = m[4] === undefined || String(prop.params.VALUE || '').toUpperCase() === 'DATE';
  if (dateOnly) return { naive: Math.floor(naive / DAY) * DAY, dateOnly: true, utc: false, tz: null };
  if (m[7]) return { naive, dateOnly: false, utc: true, tz: 'UTC' };
  const tz = resolveTz(prop.params.TZID) || fallbackTz;
  return { naive, dateOnly: false, utc: false, tz };
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(value).trim());
  if (!m) return null;
  const ms = (+(m[2] || 0) * 7 * DAY) + (+(m[3] || 0) * DAY) + (+(m[4] || 0) * 3600000) + (+(m[5] || 0) * 60000) + (+(m[6] || 0) * 1000);
  return m[1] === '-' ? -ms : ms;
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value) {
  const r = {};
  for (const part of String(value).split(';')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) continue;
    r[k.toUpperCase()] = v;
  }
  const num = (s) => s.split(',').map(Number).filter((n) => Number.isFinite(n) && n !== 0);
  const rule = {
    freq: String(r.FREQ || '').toUpperCase(),
    interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : 0,
    until: r.UNTIL || '',
    wkst: WD[String(r.WKST || 'MO').toUpperCase()] ?? 1,
    bymonth: r.BYMONTH ? num(r.BYMONTH) : null,
    bymonthday: r.BYMONTHDAY ? num(r.BYMONTHDAY) : null,
    bysetpos: r.BYSETPOS ? num(r.BYSETPOS) : null,
    byday: null,
  };
  if (r.BYDAY) {
    rule.byday = r.BYDAY.split(',').map((s) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim());
      return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] } : null;
    }).filter(Boolean);
    if (!rule.byday.length) rule.byday = null;
  }
  return rule;
}

/* ---------------- recurrence expansion (wall-clock space) ---------------- */

const floorDay = (ms) => Math.floor(ms / DAY) * DAY;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function monthDays(y, m, rule, baseD) {
  const dim = daysInMonth(y, m);
  const out = new Set();
  const wdOf = (d) => new Date(Date.UTC(y, m, d)).getUTCDay();
  if (rule.bymonthday) {
    for (const n of rule.bymonthday) {
      const d = n > 0 ? n : dim + n + 1;
      if (d >= 1 && d <= dim && (!rule.byday || rule.byday.some((b) => b.wd === wdOf(d)))) out.add(d);
    }
  } else if (rule.byday) {
    for (const { n, wd } of rule.byday) {
      const all = [];
      for (let d = 1; d <= dim; d++) if (wdOf(d) === wd) all.push(d);
      if (!n) all.forEach((d) => out.add(d));
      else {
        const d = n > 0 ? all[n - 1] : all[all.length + n];
        if (d) out.add(d);
      }
    }
  } else if (baseD <= dim) {
    out.add(baseD);
  }
  let days = [...out].sort((a, b) => a - b);
  if (rule.bysetpos) {
    days = [...new Set(rule.bysetpos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter(Boolean))].sort((a, b) => a - b);
  }
  return days.map((d) => Date.UTC(y, m, d));
}

// Yields wall-clock start times (naive ms) in ascending order, never before the base.
function* occurrences(rule, baseNaive, skipTo) {
  const baseDay = floorDay(baseNaive);
  const tod = baseNaive - baseDay;
  const base = new Date(baseDay);
  const bY = base.getUTCFullYear(), bM = base.getUTCMonth(), bD = base.getUTCDate(), bWd = base.getUTCDay();
  const iv = rule.interval;
  const skipDay = floorDay(skipTo ?? baseDay);
  const skip = new Date(skipDay);
  const weekStart0 = baseDay - ((bWd - rule.wkst + 7) % 7) * DAY;
  let k0 = 0;
  if (!rule.count && skipTo) {
    if (rule.freq === 'DAILY') k0 = Math.floor((skipDay - baseDay) / (DAY * iv));
    else if (rule.freq === 'WEEKLY') k0 = Math.floor((skipDay - weekStart0) / (7 * DAY * iv));
    else if (rule.freq === 'MONTHLY') k0 = Math.floor(((skip.getUTCFullYear() - bY) * 12 + skip.getUTCMonth() - bM) / iv);
    else if (rule.freq === 'YEARLY') k0 = Math.floor((skip.getUTCFullYear() - bY) / iv);
    k0 = Math.max(0, k0 - 1);
  }
  for (let k = k0; k < k0 + 20000; k++) {
    let days = [];
    if (rule.freq === 'DAILY') {
      const day = baseDay + k * iv * DAY;
      const d = new Date(day);
      if (
        (!rule.bymonth || rule.bymonth.includes(d.getUTCMonth() + 1)) &&
        (!rule.bymonthday || rule.bymonthday.some((n) => (n > 0 ? n : daysInMonth(d.getUTCFullYear(), d.getUTCMonth()) + n + 1) === d.getUTCDate())) &&
        (!rule.byday || rule.byday.some((b) => b.wd === d.getUTCDay()))
      ) days = [day];
    } else if (rule.freq === 'WEEKLY') {
      const ws = weekStart0 + k * iv * 7 * DAY;
      const wds = rule.byday ? [...new Set(rule.byday.map((b) => b.wd))] : [bWd];
      days = wds.map((wd) => ws + ((wd - rule.wkst + 7) % 7) * DAY).sort((a, b) => a - b);
      if (rule.bymonth) days = days.filter((d) => rule.bymonth.includes(new Date(d).getUTCMonth() + 1));
    } else if (rule.freq === 'MONTHLY') {
      const mi = bM + k * iv;
      const y = bY + Math.floor(mi / 12), m = ((mi % 12) + 12) % 12;
      if (!rule.bymonth || rule.bymonth.includes(m + 1)) days = monthDays(y, m, rule, bD);
    } else if (rule.freq === 'YEARLY') {
      const y = bY + k * iv;
      const months = rule.bymonth ? [...rule.bymonth].sort((a, b) => a - b) : [bM + 1];
      for (const mo of months) days.push(...monthDays(y, mo - 1, rule, bD));
    } else {
      return; // SECONDLY/MINUTELY/HOURLY aren't meaningful for a glance view
    }
    for (const day of days) if (day >= baseDay) yield day + tod;
  }
}

/* ---------------- feed → events ---------------- */

const toDateStr = (naive) => new Date(naive).toISOString().slice(0, 10);
const first = (ev, name) => ev[name]?.[0];
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Parse an .ics document into events overlapping [from, to).
 * opts: { from, to (ms or ISO), tz (viewer's IANA zone for floating times),
 *         label, color, feedId }
 */
export function icsToEvents(text, opts = {}) {
  const winStart = +new Date(opts.from ?? Date.now() - 7 * DAY);
  const winEnd = +new Date(opts.to ?? Date.now() + 60 * DAY);
  const fallbackTz = resolveTz(opts.tz) || 'UTC';
  const color = /^#[0-9a-f]{6}$/i.test(opts.color || '') ? opts.color : DEFAULT_COLOR;
  const feedId = opts.feedId || 'ical';
  const { events: raw, calName, calColor } = parseIcs(text);
  const calendar = opts.label || calName || 'Calendar feed';

  // Split masters from per-occurrence overrides (RECURRENCE-ID) by UID.
  const overrides = new Map(); // uid → Set(keys of replaced occurrences)
  const masters = [];
  const edits = [];
  for (const ev of raw) {
    if (/^CANCELLED$/i.test(first(ev, 'STATUS')?.value || '')) {
      // A cancelled override still removes the occurrence it points at.
      const rid = parseDateValue(first(ev, 'RECURRENCE-ID'), fallbackTz);
      const uid = first(ev, 'UID')?.value;
      if (rid && uid) {
        const set = overrides.get(uid) || overrides.set(uid, new Set()).get(uid);
        set.add(rid.dateOnly ? rid.naive : naiveToInstant(rid.naive, rid.tz));
      }
      continue;
    }
    if (first(ev, 'RECURRENCE-ID')) edits.push(ev);
    else masters.push(ev);
  }
  for (const ev of edits) {
    const rid = parseDateValue(first(ev, 'RECURRENCE-ID'), fallbackTz);
    const uid = first(ev, 'UID')?.value;
    if (!rid || !uid) continue;
    const set = overrides.get(uid) || overrides.set(uid, new Set()).get(uid);
    set.add(rid.dateOnly ? rid.naive : naiveToInstant(rid.naive, rid.tz));
  }

  const out = [];
  const push = (ev, startInst, dur, dateOnly, ordinal) => {
    if (out.length >= MAX_EVENTS_PER_FEED) return;
    const uid = first(ev, 'UID')?.value || `${feedId}-${ordinal}`;
    const title = clip(unescapeText(first(ev, 'SUMMARY')?.value || '').trim() || '(no title)', 200);
    const loc = clip(unescapeText(first(ev, 'LOCATION')?.value || '').replace(/\s*\n\s*/g, ', ').trim(), 300);
    const url = first(ev, 'URL')?.value?.trim();
    out.push({
      id: `${feedId}:${uid}:${startInst}`,
      cal_id: feedId,
      title,
      starts_at: dateOnly ? toDateStr(startInst) : new Date(startInst).toISOString(),
      ends_at: dateOnly ? toDateStr(startInst + dur) : dur > 0 ? new Date(startInst + dur).toISOString() : null,
      all_day: dateOnly,
      calendar,
      color,
      location: loc || undefined,
      html_link: url && /^https:\/\//i.test(url) ? url : undefined,
    });
  };

  const overlaps = (start, dur, dateOnly) =>
    dateOnly
      ? start < winEnd + DAY && start + dur > winStart - DAY
      : start < winEnd && start + Math.max(dur, 1) > winStart;

  let ordinal = 0;
  for (const ev of [...masters, ...edits]) {
    ordinal++;
    const dtstart = parseDateValue(first(ev, 'DTSTART'), fallbackTz);
    if (!dtstart) continue;
    const dateOnly = dtstart.dateOnly;
    const tz = dtstart.tz;
    const toInst = (n) => (dateOnly ? n : naiveToInstant(n, tz));
    const baseInst = toInst(dtstart.naive);

    // Duration: DTEND − DTSTART, else DURATION, else 1 day (date) / 0 (timed).
    let dur = dateOnly ? DAY : 0;
    const dtend = parseDateValue(first(ev, 'DTEND'), fallbackTz);
    if (dtend) dur = Math.max(0, (dtend.dateOnly ? dtend.naive : naiveToInstant(dtend.naive, dtend.tz)) - baseInst);
    else if (first(ev, 'DURATION')) dur = Math.max(0, parseDuration(first(ev, 'DURATION').value) ?? dur);
    if (dateOnly) dur = Math.max(DAY, Math.round(dur / DAY) * DAY);

    const rrule = first(ev, 'RRULE');
    const isMaster = !first(ev, 'RECURRENCE-ID');
    if (!rrule || !isMaster) {
      // Single instance (or an override) — emit unless it was cancelled/replaced.
      const replaced = isMaster && overrides.get(first(ev, 'UID')?.value)?.has(baseInst);
      if (!replaced && overlaps(baseInst, dur, dateOnly)) push(ev, baseInst, dur, dateOnly, ordinal);
    }
    if (!rrule || !isMaster) {
      // RDATEs on non-recurring masters are rare; handled with the recurring path below.
      if (!first(ev, 'RDATE')) continue;
    }

    const rule = rrule ? parseRule(rrule.value) : { freq: '', interval: 1, count: 0 };
    const excluded = new Set(overrides.get(first(ev, 'UID')?.value) || []);
    for (const ex of ev.EXDATE || []) {
      for (const v of String(ex.value).split(',')) {
        const p = parseDateValue({ value: v, params: ex.params }, fallbackTz);
        if (p) excluded.add(p.dateOnly ? p.naive : naiveToInstant(p.naive, p.tz));
      }
    }

    // Skip-ahead target: wall-clock time a day before the window opens.
    const skipTo = winStart - 2 * DAY + (dateOnly || !tz || tz === 'UTC' ? 0 : tzOffset(winStart, tz));
    let n = 0;
    let untilInst = Infinity;
    if (rule.until) {
      const u = parseDateValue({ value: rule.until, params: { TZID: '' } }, tz || 'UTC');
      if (u) untilInst = u.dateOnly ? (dateOnly ? u.naive : naiveToInstant(u.naive + DAY, tz) - 1) : u.utc ? u.naive : naiveToInstant(u.naive, tz);
    }
    if (rule.freq) {
      // A repeating timed event longer than its own interval (e.g. a daily event
      // whose end date was set a year out) would overlap itself every day, so its
      // stored length isn't a real duration. Show each occurrence as a 1-hour marker.
      const period = { DAILY: DAY, WEEKLY: 7 * DAY, MONTHLY: 28 * DAY, YEARLY: 365 * DAY }[rule.freq] * rule.interval;
      const selfOverlap = !dateOnly && dur >= period;
      for (const naive of occurrences(rule, dtstart.naive, skipTo)) {
        const inst = toInst(naive);
        if (inst >= winEnd + (dateOnly ? DAY : 0)) break;
        n++;
        if (rule.count && n > rule.count) break;
        if (inst > untilInst) break;
        if (excluded.has(inst)) continue;
        const occDur = selfOverlap ? 60 * 60000 : dur;
        if (overlaps(inst, occDur, dateOnly)) push(ev, inst, occDur, dateOnly, ordinal);
        if (out.length >= MAX_EVENTS_PER_FEED) break;
      }
    }
    for (const rd of ev.RDATE || []) {
      for (const v of String(rd.value).split(',')) {
        const p = parseDateValue({ value: v.split('/')[0], params: rd.params }, fallbackTz);
        if (!p) continue;
        const inst = p.dateOnly ? p.naive : naiveToInstant(p.naive, p.tz);
        if (!excluded.has(inst) && overlaps(inst, dur, dateOnly)) push(ev, inst, dur, dateOnly, ordinal);
      }
    }
  }

  out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { events: out, calendar, calendarColor: calColor };
}

/* ---------------- request handler (shared by Express + Worker) ---------------- */

const validTz = (tz) => (typeof tz === 'string' && resolveTz(tz)) || 'UTC';

/**
 * body: { feeds: [{ id, label, url, color }], timeMin, timeMax, tz }
 * → { events, feeds: [{ id, ok, count, error? }] }
 * One failing feed never hides the others.
 */
export async function icalEvents(body = {}) {
  const feeds = Array.isArray(body.feeds) ? body.feeds.slice(0, MAX_FEEDS) : [];
  const from = Date.parse(body.timeMin) || Date.now() - 7 * DAY;
  let to = Date.parse(body.timeMax) || from + 60 * DAY;
  to = Math.min(to, from + MAX_RANGE_DAYS * DAY);
  const tz = validTz(body.tz);

  const results = await Promise.all(
    feeds.map(async (feed, i) => {
      const id = String(feed?.id || `feed${i}`).slice(0, 40);
      try {
        const text = await fetchIcs(feed?.url);
        const { events, calendarColor } = icsToEvents(text, { from, to, tz, feedId: id, label: feed?.label ? String(feed.label).slice(0, 80) : '', color: feed?.color });
        return { id, ok: true, events, calendarColor };
      } catch (e) {
        return { id, ok: false, events: [], error: e?.message || 'Feed failed to load.', code: e?.code };
      }
    })
  );
  return {
    events: results.flatMap((r) => r.events).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    feeds: results.map((r) => ({ id: r.id, ok: r.ok, count: r.events.length, ...(r.ok ? { suggestedColor: r.calendarColor || undefined } : { error: r.error, code: r.code }) })),
  };
}
