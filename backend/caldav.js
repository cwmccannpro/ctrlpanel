// ============================================================
// CTRLpanel — iCloud Calendar, read + write over CalDAV
//
// The user connects with their Apple ID and an *app-specific password*
// (appleid.apple.com → Sign-In and Security → App-Specific Passwords). The
// password is encrypted (AES-256-GCM) before it is stored in `caldav_accounts`,
// a service-role-only table (RLS on, no policy), and it never goes back to the
// browser.
//
// Only iCloud hosts (https://*.icloud.com) are ever contacted, and every href
// the browser sends back must sit inside the account's own calendar home, so
// this can't be used to reach anything else.
//
// Reads reuse backend/ical.js (RRULE expansion, time zones). Writes:
//   create → PUT a new .ics with If-None-Match: *
//   update → GET the event, patch only the edited properties, PUT with If-Match
//   delete → DELETE with If-Match
// Recurring events are shown but only editable in Apple Calendar (editing one
// occurrence safely needs RECURRENCE-ID overrides, which this doesn't write).
//
// One dispatcher (`handleCaldavRequest`) serves Express and the Worker.
// Workers-compatible: plain fetch + node:crypto only.
// ============================================================
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { mapCalendarColor, verifyUserToken } from './google.js';
import { icsToEvents, resolveTz } from './ical.js';

export const ICLOUD_ROOT = 'https://caldav.icloud.com/';
const DAY = 86400000;
const MAX_BODY = 65536;
const MAX_RANGE_DAYS = 400;
const MAX_CALENDARS = 30;
const MAX_RESPONSE = 20 * 1024 * 1024;
const TIMEOUT_MS = 15000;

export class CaldavError extends Error {
  constructor(message, status = 400, code = 'caldav_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status, code) => new CaldavError(message, status, code);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('iCloud calendar storage is not configured on the server.', 503, 'not_configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ---------------- host safety ---------------- */

export function assertIcloudUrl(input) {
  const u = input instanceof URL ? input : new URL(String(input));
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) {
    throw fail('Only secure iCloud calendar addresses are allowed.', 400, 'bad_host');
  }
  if (!(host === 'icloud.com' || host.endsWith('.icloud.com'))) {
    throw fail('Only iCloud calendar servers are allowed.', 400, 'bad_host');
  }
  u.port = '';
  return u;
}

// An href the browser sent back must be inside this account's calendar home.
export function ownUrl(home, href) {
  const base = new URL(home);
  let u;
  try {
    u = assertIcloudUrl(new URL(String(href || ''), base));
  } catch (e) {
    if (e instanceof CaldavError) throw e;
    throw fail('That isn’t a valid iCloud calendar address.', 400, 'bad_href');
  }
  if (u.host !== base.host || !u.pathname.startsWith(base.pathname) || u.search || u.hash) {
    throw fail('That item isn’t in your iCloud calendars.', 400, 'bad_href');
  }
  return u;
}

/* ---------------- password sealing ---------------- */

function sealKey() {
  const secret = process.env.CALDAV_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw fail('iCloud calendar storage is not configured on the server.', 503, 'not_configured');
  return createHash('sha256').update(`ctrlpanel-caldav:${secret}`).digest();
}

export function sealSecret(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sealKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function openSecret(sealed) {
  try {
    const [v, iv, tag, ct] = String(sealed || '').split('.');
    if (v !== 'v1') throw new Error('version');
    const d = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    if (e instanceof CaldavError) throw e;
    throw fail('Reconnect iCloud: the saved password can no longer be read.', 409, 'reconnect');
  }
}

/* ---------------- tiny XML reader (no DOM in Workers) ---------------- */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()];
  });

export function xmlText(s) {
  const src = String(s ?? '');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += decodeEntities(src.slice(last, m.index)) + m[1];
    last = re.lastIndex;
  }
  return (out + decodeEntities(src.slice(last))).trim();
}

// Namespace-prefix agnostic: <d:href>, <D:href>, <href xmlns="DAV:"> all match.
const tagRe = (name, flags) =>
  new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`, flags);
const tag = (xml, name) => {
  const m = tagRe(name, 'i').exec(xml || '');
  return m ? m[1] ?? '' : null;
};
const tags = (xml, name) => [...String(xml || '').matchAll(tagRe(name, 'gi'))].map((m) => m[1] ?? '');

// → [{ href, prop }] where `prop` holds only the 2xx propstat contents.
export function parseMultistatus(xml) {
  return tags(xml, 'response').map((r) => ({
    href: xmlText(tag(r, 'href') || ''),
    prop: tags(r, 'propstat')
      .filter((ps) => /\b2\d\d\b/.test(xmlText(tag(ps, 'status') || '')))
      .map((ps) => tag(ps, 'prop') || '')
      .join(''),
  }));
}

/* ---------------- CalDAV requests ---------------- */

const normEtag = (e) => String(e || '').replace(/^W\//, '').replace(/"/g, '');

async function dav(acct, target, { method = 'PROPFIND', depth, body, headers = {} } = {}) {
  let url = assertIcloudUrl(new URL(String(target)));
  const auth = `Basic ${Buffer.from(`${acct.username}:${acct.password}`).toString('base64')}`;
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          authorization: auth,
          'user-agent': 'CTRLpanel-caldav/1.0',
          ...(body ? { 'content-type': 'application/xml; charset=utf-8' } : {}),
          ...(depth != null ? { depth: String(depth) } : {}),
          ...headers,
        },
        body,
      });
    } catch (e) {
      throw e?.name === 'AbortError'
        ? fail('iCloud took too long to respond. Try again.', 504, 'timeout')
        : fail('Couldn’t reach iCloud. Try again.', 502, 'unreachable');
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw fail('iCloud redirected without a destination.', 502, 'unavailable');
      url = assertIcloudUrl(new URL(loc, url)); // every hop re-checked
      continue;
    }
    // 422, not 401: a 401 from us would read as "your CTRLpanel session expired".
    if (res.status === 401) throw fail('Apple didn’t accept that Apple ID and app-specific password.', 422, 'auth');
    if (res.status === 403) throw fail('That iCloud calendar is read-only.', 403, 'read_only');
    if (res.status === 404 || res.status === 410) throw fail('That event no longer exists in iCloud. Refresh the calendar.', 404, 'not_found');
    if (res.status === 412) throw fail('This event changed in iCloud since it loaded. Refresh and try again.', 409, 'conflict');
    if (res.status === 429 || res.status === 503) throw fail('iCloud is busy right now. Try again in a minute.', 503, 'busy');
    if (!res.ok && res.status !== 207) throw fail(`iCloud returned HTTP ${res.status}.`, 502, 'unavailable');
    const text = await res.text();
    if (text.length > MAX_RESPONSE) throw fail('iCloud sent back too much data. Pick a shorter range.', 502, 'too_large');
    return { status: res.status, headers: res.headers, text, url };
  }
  throw fail('iCloud redirected too many times.', 502, 'unavailable');
}

const PROPFIND_PRINCIPAL =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const PROPFIND_HOME =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const PROPFIND_CALENDARS =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">' +
  '<d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>';

export async function discover(acct) {
  const r1 = await dav(acct, ICLOUD_ROOT, { depth: 0, body: PROPFIND_PRINCIPAL });
  const principalHref = xmlText(tag(tag(parseMultistatus(r1.text)[0]?.prop, 'current-user-principal'), 'href') || '');
  if (!principalHref) throw fail('iCloud didn’t return your calendar account.', 502, 'unavailable');
  const principal = assertIcloudUrl(new URL(principalHref, r1.url));
  const r2 = await dav(acct, principal, { depth: 0, body: PROPFIND_HOME });
  const homeHref = xmlText(tag(tag(parseMultistatus(r2.text)[0]?.prop, 'calendar-home-set'), 'href') || '');
  if (!homeHref) throw fail('iCloud didn’t return your calendar list.', 502, 'unavailable');
  const home = assertIcloudUrl(new URL(homeHref, r2.url));
  if (!home.pathname.endsWith('/')) home.pathname += '/';
  return { principal: principal.toString(), home: home.toString() };
}

const hasTag = (xml, name) => tagRe(name, 'i').test(xml || '');

export function calendarsFromMultistatus(xml, baseUrl) {
  const out = [];
  for (const r of parseMultistatus(xml)) {
    if (!r.href || !hasTag(tag(r.prop, 'resourcetype'), 'calendar')) continue;
    const comps = tag(r.prop, 'supported-calendar-component-set');
    if (comps && !/name\s*=\s*["']VEVENT["']/i.test(comps)) continue; // Reminders lists etc.
    const privs = tag(r.prop, 'current-user-privilege-set');
    const writable = privs == null || /<(?:[\w.-]+:)?(?:write|write-content|all)(?=[\s/>])/i.test(privs);
    const hex = /#([0-9a-f]{6})/i.exec(xmlText(tag(r.prop, 'calendar-color') || ''));
    const url = new URL(r.href, baseUrl);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    out.push({
      id: url.toString(),
      name: xmlText(tag(r.prop, 'displayname') || '') || 'iCloud',
      color: hex ? mapCalendarColor(`#${hex[1]}`) : '#3b82f6',
      writable,
    });
  }
  return out.slice(0, MAX_CALENDARS);
}

export async function listCalendars(acct) {
  const r = await dav(acct, acct.home_url, { depth: 1, body: PROPFIND_CALENDARS });
  return calendarsFromMultistatus(r.text, r.url).filter((c) => {
    try {
      ownUrl(acct.home_url, c.id);
      return true;
    } catch {
      return false;
    }
  });
}

const fmtUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const reportBody = (from, to) =>
  '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  '<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
  `<c:time-range start="${fmtUtc(from)}" end="${fmtUtc(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

// One calendar's REPORT body → app events (Google-shaped, plus href/etag for writes).
export function eventsFromReport(xml, cal, { from, to, tz, baseUrl }) {
  const out = [];
  for (const r of parseMultistatus(xml)) {
    const ics = xmlText(tag(r.prop, 'calendar-data') || '');
    if (!ics || !r.href) continue;
    const href = new URL(r.href, baseUrl).toString();
    const etag = xmlText(tag(r.prop, 'getetag') || '') || null;
    const recurring = /^(RRULE|RDATE|RECURRENCE-ID)[;:]/im.test(ics);
    const { events } = icsToEvents(ics, { from, to, tz, feedId: cal.id, label: cal.name, color: cal.color });
    for (const e of events) {
      out.push({ ...e, source: 'icloud', href, etag, recurring, editable: cal.writable && !recurring });
    }
  }
  return out;
}

export async function listEvents(acct, { timeMin, timeMax, tz } = {}) {
  const from = Date.parse(timeMin) || Date.now() - 7 * DAY;
  let to = Date.parse(timeMax) || from + 60 * DAY;
  to = Math.min(Math.max(to, from + 60000), from + MAX_RANGE_DAYS * DAY);
  const zone = (typeof tz === 'string' && resolveTz(tz)) || 'UTC';
  const calendars = await listCalendars(acct);
  const results = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const r = await dav(acct, cal.id, { method: 'REPORT', depth: 1, body: reportBody(from, to) });
        return { events: eventsFromReport(r.text, cal, { from, to, tz: zone, baseUrl: r.url }) };
      } catch (e) {
        if (e?.code === 'auth') throw e;
        return { events: [], error: { calendar: cal.name, error: e?.message || 'Couldn’t load this calendar.' } };
      }
    })
  );
  return {
    connected: true,
    calendars,
    events: results.flatMap((r) => r.events).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    errors: results.map((r) => r.error).filter(Boolean),
  };
}

/* ---------------- writing .ics ---------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const nextDay = (s) => new Date(Date.parse(`${s}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

const optText = (v, max, label) => {
  if (v === undefined) return undefined;
  if (v !== null && typeof v !== 'string') throw fail(`${label} must be text.`, 400, 'invalid');
  const s = String(v ?? '').trim();
  if (s.length > max) throw fail(`${label} is too long (max ${max} characters).`, 400, 'invalid');
  return s;
};

// Absent `location` / `notes` mean "leave as is" on an update.
export function validateEvent(ev = {}) {
  if (!ev || typeof ev !== 'object') throw fail('An event is required.', 400, 'invalid');
  const title = optText(ev.title, 300, 'Title') || '';
  if (!title) throw fail('Give the event a title.', 400, 'invalid');
  const v = { title, location: optText(ev.location, 300, 'Location'), notes: optText(ev.notes, 4000, 'Notes'), allDay: Boolean(ev.all_day) };
  if (v.allDay) {
    const start = String(ev.starts_at || '').slice(0, 10);
    const end = ev.ends_at ? String(ev.ends_at).slice(0, 10) : nextDay(start);
    if (!validDate(start) || !validDate(end)) throw fail('All-day events need dates as YYYY-MM-DD.', 400, 'invalid');
    if (end <= start) throw fail('The end date must be after the start date.', 400, 'invalid');
    if (Date.parse(end) - Date.parse(start) > 366 * DAY) throw fail('Events can be at most a year long.', 400, 'invalid');
    return { ...v, start, end };
  }
  const startMs = Date.parse(ev.starts_at);
  const endMs = ev.ends_at ? Date.parse(ev.ends_at) : startMs + 3600000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw fail('The event needs a valid start and end time.', 400, 'invalid');
  if (endMs <= startMs) throw fail('The end time must be after the start time.', 400, 'invalid');
  if (endMs - startMs > 31 * DAY) throw fail('Timed events can be at most 31 days long.', 400, 'invalid');
  return { ...v, startMs, endMs };
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 §3.1: lines over 75 octets fold with CRLF + space.
const enc = new TextEncoder();
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function eventProps(v) {
  const time = v.allDay
    ? [`DTSTART;VALUE=DATE:${v.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${v.end.replace(/-/g, '')}`]
    : [`DTSTART:${fmtUtc(v.startMs)}`, `DTEND:${fmtUtc(v.endMs)}`];
  return [
    ...time,
    `SUMMARY:${esc(v.title)}`,
    ...(v.location ? [`LOCATION:${esc(v.location)}`] : []),
    ...(v.notes ? [`DESCRIPTION:${esc(v.notes)}`] : []),
  ];
}

export function buildIcs(v, uid, now = Date.now()) {
  const stamp = fmtUtc(now);
  return `${[
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CTRLpanel//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    'SEQUENCE:0',
    ...eventProps(v),
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldLine).join('\r\n')}\r\n`;
}

/**
 * Rewrite the edited properties of the single VEVENT in `text`, keeping
 * everything else (alarms, attendees, URL, Apple's own X- properties) as is.
 * Throws for recurring / multi-instance objects.
 */
export function patchIcs(text, v, now = Date.now()) {
  const physical = String(text).replace(/\r\n?/g, '\n').split('\n');
  const logical = [];
  for (const l of physical) {
    if (/^[ \t]/.test(l) && logical.length) logical[logical.length - 1] += `\n${l}`;
    else logical.push(l);
  }
  const replaced = new Set(['DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'DTSTAMP', 'LAST-MODIFIED', 'SEQUENCE']);
  if (v.location !== undefined) replaced.add('LOCATION');
  if (v.notes !== undefined) replaced.add('DESCRIPTION');
  const out = [];
  let inEvent = false;
  let nested = 0;
  let events = 0;
  let seq = 0;
  for (const raw of logical) {
    const name = raw.split(/[;:]/)[0].trim().toUpperCase();
    const value = raw.slice(raw.indexOf(':') + 1).trim().toUpperCase();
    if (!inEvent) {
      if (name === 'BEGIN' && value === 'VEVENT') {
        inEvent = true;
        events++;
      }
      out.push(raw);
      continue;
    }
    if (name === 'BEGIN') nested++;
    else if (name === 'END' && nested) nested--;
    else if (name === 'END' && value === 'VEVENT') {
      const stamp = fmtUtc(now);
      out.push(`DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${seq + 1}`, ...eventProps(v));
      inEvent = false;
    } else if (!nested) {
      if (name === 'RRULE' || name === 'RDATE' || name === 'RECURRENCE-ID') {
        throw fail('Repeating events can only be edited in Apple Calendar for now.', 400, 'recurring');
      }
      if (name === 'SEQUENCE') seq = parseInt(value, 10) || 0;
      if (replaced.has(name)) continue;
    }
    out.push(raw);
  }
  if (events !== 1) throw fail('Repeating events can only be edited in Apple Calendar for now.', 400, 'recurring');
  // Untouched lines keep their original folding; new ones are folded here.
  return `${out.filter((l, i) => l !== '' || i < out.length - 1).map((l) => (l.includes('\n') ? l : foldLine(l))).join('\n').replace(/\n/g, '\r\n').replace(/\r\n$/, '')}\r\n`;
}

const parentOf = (u) => new URL('./', u).toString();

export async function createEvent(acct, ev) {
  const cal = ownUrl(acct.home_url, ev.cal_id);
  if (!cal.pathname.endsWith('/') || cal.pathname === new URL(acct.home_url).pathname) throw fail('Pick a calendar for the event.', 400, 'invalid');
  const v = validateEvent(ev);
  const uid = randomUUID().toUpperCase();
  const href = new URL(`${uid}.ics`, cal);
  const put = await dav(acct, href, {
    method: 'PUT',
    body: buildIcs(v, uid),
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' },
  });
  return { ok: true, href: href.toString(), etag: put.headers.get('etag') || null, uid };
}

export async function updateEvent(acct, ev) {
  const href = ownUrl(acct.home_url, ev.href);
  const v = validateEvent(ev);
  const cur = await dav(acct, href, { method: 'GET' });
  const etag = cur.headers.get('etag');
  if (ev.etag && etag && normEtag(ev.etag) !== normEtag(etag)) {
    throw fail('This event changed in iCloud since it loaded. Refresh and try again.', 409, 'conflict');
  }
  const next = patchIcs(cur.text, v);
  const target = ev.cal_id ? ownUrl(acct.home_url, ev.cal_id) : null;
  if (target && target.toString() !== parentOf(href)) {
    // Moving to another calendar: write the copy first, then remove the original.
    const moved = new URL(href.pathname.split('/').pop(), target);
    const put = await dav(acct, moved, { method: 'PUT', body: next, headers: { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' } });
    await dav(acct, href, { method: 'DELETE', headers: etag ? { 'if-match': etag } : {} });
    return { ok: true, href: moved.toString(), etag: put.headers.get('etag') || null };
  }
  const put = await dav(acct, href, {
    method: 'PUT',
    body: next,
    headers: { 'content-type': 'text/calendar; charset=utf-8', ...(etag ? { 'if-match': etag } : {}) },
  });
  return { ok: true, href: href.toString(), etag: put.headers.get('etag') || null };
}

export async function deleteEvent(acct, { href, etag } = {}) {
  const url = ownUrl(acct.home_url, href);
  try {
    await dav(acct, url, { method: 'DELETE', headers: etag ? { 'if-match': etag } : {} });
  } catch (e) {
    if (e?.code !== 'not_found') throw e; // already gone is fine
  }
  return { ok: true };
}

/* ---------------- account storage ---------------- */

async function loadAccount(db, userId) {
  const { data, error } = await db.from('caldav_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw fail('iCloud calendar storage is unavailable. Apply the iCloud calendar migration.', 503, 'storage');
  if (!data) return null;
  return { ...data, password: openSecret(data.secret) };
}

async function requireAccount(db, userId) {
  const acct = await loadAccount(db, userId);
  if (!acct) throw fail('Connect your iCloud calendar first.', 409, 'not_connected');
  return acct;
}

export async function connectAccount(db, userId, body = {}) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '').replace(/\s+/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 200) throw fail('Enter the email address of your Apple ID.', 400, 'invalid');
  if (password.length < 16 || password.length > 64) {
    throw fail('Paste an app-specific password (16 letters, like abcd-efgh-ijkl-mnop), not your Apple ID password.', 400, 'invalid');
  }
  const acct = { username, password };
  const found = await discover(acct);
  const calendars = await listCalendars({ ...acct, home_url: found.home });
  const { error } = await db.from('caldav_accounts').upsert(
    { user_id: userId, username, secret: sealSecret(password), principal_url: found.principal, home_url: found.home, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
  if (error) throw fail('iCloud calendar storage is unavailable. Apply the iCloud calendar migration.', 503, 'storage');
  return { connected: true, username, calendars };
}

/* ---------------- dispatcher (Express + Worker) ---------------- */

export async function handleCaldavRequest(request, { client, verify = verifyUserToken } = {}) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/caldav\/?/, '').replace(/\/$/, '');
    const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) throw fail('Sign in to use your iCloud calendar.', 401, 'unauthenticated');
    const user = await verify(token);
    if (!user?.id) throw fail('Sign in to use your iCloud calendar.', 401, 'unauthenticated');

    let body = {};
    if (request.method === 'POST') {
      const raw = await request.text();
      if (enc.encode(raw).length > MAX_BODY) throw fail('That request is too large.', 413, 'too_large');
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw fail('Invalid JSON.', 400, 'invalid');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('A JSON object is required.', 400, 'invalid');
    }

    if (path === 'status' && request.method === 'GET') {
      let db;
      try {
        db = client || admin();
        sealKey();
      } catch {
        return json({ connected: false, configured: false });
      }
      const { data, error } = await db.from('caldav_accounts').select('username').eq('user_id', user.id).maybeSingle();
      if (error) return json({ connected: false, configured: false, error: 'Apply the iCloud calendar migration.' });
      return json({ connected: Boolean(data), configured: true, username: data?.username || null });
    }

    if (request.method !== 'POST') throw fail('Not found.', 404, 'not_found');
    const db = client || admin();
    if (path === 'connect') return json(await connectAccount(db, user.id, body));
    if (path === 'disconnect') {
      const { error } = await db.from('caldav_accounts').delete().eq('user_id', user.id);
      if (error) throw fail('Couldn’t disconnect iCloud. Try again.', 503, 'storage');
      return json({ ok: true });
    }
    const acct = await requireAccount(db, user.id);
    if (path === 'calendars') return json({ calendars: await listCalendars(acct) });
    if (path === 'list') return json(await listEvents(acct, body));
    if (path === 'create') return json(await createEvent(acct, body.event || {}));
    if (path === 'update') return json(await updateEvent(acct, body.event || {}));
    if (path === 'delete') return json(await deleteEvent(acct, body));
    throw fail('Not found.', 404, 'not_found');
  } catch (e) {
    if (e instanceof CaldavError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: 'The iCloud calendar request failed.', code: 'internal' }, 500);
  }
}
