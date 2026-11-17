import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  assertIcloudUrl, buildIcs, calendarsFromMultistatus, eventsFromReport, foldLine, handleCaldavRequest,
  openSecret, ownUrl, patchIcs, sealSecret, validateEvent,
} from '../backend/caldav.js';
import { icsToEvents } from '../backend/ical.js';

process.env.CALDAV_SECRET = 'test-secret-for-caldav';

const HOME = 'https://p52-caldav.icloud.com/123/calendars/';
const WORK = `${HOME}work/`;
const HOMECAL = `${HOME}home/`;

/* ---------------- pure pieces ---------------- */

test('only https iCloud hosts are allowed', () => {
  assert.equal(assertIcloudUrl('https://p52-caldav.icloud.com:443/x/').toString(), 'https://p52-caldav.icloud.com/x/');
  for (const bad of ['http://caldav.icloud.com/', 'https://evil.com/', 'https://icloud.com.evil.com/', 'https://u:p@caldav.icloud.com/', 'https://caldav.icloud.com:8443/']) {
    assert.throws(() => assertIcloudUrl(bad), { code: 'bad_host' }, bad);
  }
});

test('hrefs must stay inside the account home', () => {
  assert.equal(ownUrl(HOME, '/123/calendars/work/a.ics').toString(), `${WORK}a.ics`);
  assert.throws(() => ownUrl(HOME, '/456/calendars/work/a.ics'), { code: 'bad_href' });
  assert.throws(() => ownUrl(HOME, '/123/calendars/../../456/a.ics'), { code: 'bad_href' });
  assert.throws(() => ownUrl(HOME, '/123/calendars/%2e%2e/%2e%2e/456/a.ics'), { code: 'bad_href' });
  assert.throws(() => ownUrl(HOME, 'https://p01-caldav.icloud.com/123/calendars/work/a.ics'), { code: 'bad_href' });
  assert.throws(() => ownUrl(HOME, 'https://evil.com/123/calendars/a.ics'), { code: 'bad_host' });
});

test('the app-specific password is sealed, and tampering is caught', () => {
  const sealed = sealSecret('abcd-efgh-ijkl-mnop');
  assert.ok(!sealed.includes('abcd'));
  assert.equal(openSecret(sealed), 'abcd-efgh-ijkl-mnop');
  const parts = sealed.split('.');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => openSecret(parts.join('.')), { code: 'reconnect' });
});

const calendarsXml = `<?xml version="1.0"?>
<multistatus xmlns="DAV:">
  <response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
  <response><href>/123/calendars/work/</href><propstat><prop>
    <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
    <displayname>Work &amp; School</displayname>
    <calendar-color xmlns="http://apple.com/ns/ical/">#1BADF8FF</calendar-color>
    <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set>
    <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat></response>
  <response><href>/123/calendars/shared/</href><propstat><prop>
    <resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype>
    <displayname>Family</displayname>
    <current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat></response>
  <response><href>/123/calendars/tasks/</href><propstat><prop>
    <resourcetype><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
    <displayname>Reminders</displayname>
    <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat></response>
  <response><href>/123/calendars/inbox/</href><propstat><prop><resourcetype><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

test('calendar discovery keeps event calendars and reads write access', () => {
  const cals = calendarsFromMultistatus(calendarsXml, HOME);
  assert.deepEqual(cals.map((c) => [c.id, c.name, c.writable]), [
    [WORK, 'Work & School', true],
    [`${HOME}shared/`, 'Family', false],
  ]);
  assert.match(cals[0].color, /^#[0-9a-f]{6}$/);
});

const vcal = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

test('REPORT results become editable events; repeating ones stay read-only', () => {
  const single = vcal('BEGIN:VEVENT', 'UID:one', 'DTSTART:20261117T150000Z', 'DTEND:20261117T160000Z', 'SUMMARY:Dentist', 'DESCRIPTION:Bring card', 'END:VEVENT');
  const weekly = vcal('BEGIN:VEVENT', 'UID:two', 'DTSTART:20261116T140000Z', 'DTEND:20261116T143000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Standup', 'END:VEVENT');
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
    <d:response><d:href>/123/calendars/work/one.ics</d:href><d:propstat><d:prop><d:getetag>"e1"</d:getetag><cal:calendar-data><![CDATA[${single}]]></cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
    <d:response><d:href>/123/calendars/work/two.ics</d:href><d:propstat><d:prop><d:getetag>"e2"</d:getetag><cal:calendar-data>${weekly.replace(/&/g, '&amp;')}</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  </d:multistatus>`;
  const cal = { id: WORK, name: 'Work', color: '#3b82f6', writable: true };
  const evs = eventsFromReport(xml, cal, { from: Date.parse('2026-11-16T00:00:00Z'), to: Date.parse('2026-11-23T00:00:00Z'), tz: 'UTC', baseUrl: HOME });
  const dentist = evs.find((e) => e.title === 'Dentist');
  assert.equal(dentist.href, `${WORK}one.ics`);
  assert.equal(dentist.etag, '"e1"');
  assert.equal(dentist.editable, true);
  assert.equal(dentist.notes, 'Bring card');
  assert.equal(dentist.source, 'icloud');
  const standups = evs.filter((e) => e.title === 'Standup');
  assert.equal(standups.length, 3);
  assert.ok(standups.every((e) => e.recurring && !e.editable));
});

test('validateEvent checks times, dates and lengths', () => {
  assert.throws(() => validateEvent({ title: '', starts_at: '2026-11-17T10:00:00Z' }), /title/);
  assert.throws(() => validateEvent({ title: 'x', starts_at: '2026-11-17T10:00:00Z', ends_at: '2026-11-17T09:00:00Z' }), /after/);
  assert.throws(() => validateEvent({ title: 'x', all_day: true, starts_at: '2026-02-30' }), /YYYY-MM-DD/);
  assert.deepEqual(validateEvent({ title: 'Trip', all_day: true, starts_at: '2026-11-20' }), { title: 'Trip', location: undefined, notes: undefined, allDay: true, start: '2026-11-20', end: '2026-11-21' });
});

test('buildIcs round-trips through the parser and folds long lines', () => {
  const v = validateEvent({ title: 'Lunch, with; Sam', starts_at: '2026-11-17T17:00:00Z', ends_at: '2026-11-17T18:00:00Z', location: 'Cafe', notes: 'Line 1\nLine 2 '.repeat(20) });
  const ics = buildIcs(v, 'UID-1', Date.parse('2026-11-16T00:00:00Z'));
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  const [e] = icsToEvents(ics, { from: Date.parse('2026-11-16T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z'), feedId: 'w' }).events;
  assert.equal(e.title, 'Lunch, with; Sam');
  assert.equal(e.starts_at, '2026-11-17T17:00:00.000Z');
  assert.equal(e.location, 'Cafe');
  assert.match(e.notes, /^Line 1\nLine 2/);
  assert.equal(foldLine('x'.repeat(200)).split('\r\n ').join(''), 'x'.repeat(200));
});

test('patchIcs edits only what changed and keeps alarms and Apple properties', () => {
  const original = vcal(
    'BEGIN:VEVENT', 'UID:abc', 'DTSTAMP:20261101T000000Z', 'SEQUENCE:2', 'DTSTART;TZID=America/New_York:20261117T090000',
    'DTEND;TZID=America/New_York:20261117T100000', 'SUMMARY:Old', 'LOCATION:Room 1', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Reminder', 'END:VALARM', 'END:VEVENT',
  );
  const v = validateEvent({ title: 'New', starts_at: '2026-11-17T15:00:00Z', ends_at: '2026-11-17T16:30:00Z' });
  const out = patchIcs(original, v, Date.parse('2026-11-16T12:00:00Z'));
  assert.match(out, /SUMMARY:New/);
  assert.doesNotMatch(out, /SUMMARY:Old/);
  assert.match(out, /LOCATION:Room 1/); // not sent → kept
  assert.match(out, /SEQUENCE:3/);
  assert.match(out, /X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC/);
  assert.match(out, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM/); // the alarm's DESCRIPTION survives
  assert.equal((out.match(/^DTSTART/gm) || []).length, 1);
  const [e] = icsToEvents(out, { from: Date.parse('2026-11-16T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z'), feedId: 'w' }).events;
  assert.equal(e.starts_at, '2026-11-17T15:00:00.000Z');
  assert.equal(e.ends_at, '2026-11-17T16:30:00.000Z');

  const cleared = patchIcs(original, validateEvent({ title: 'New', starts_at: '2026-11-17T15:00:00Z', location: '' }));
  assert.doesNotMatch(cleared, /LOCATION/);
  const repeating = vcal('BEGIN:VEVENT', 'UID:r', 'DTSTART:20261117T150000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:R', 'END:VEVENT');
  assert.throws(() => patchIcs(repeating, v), { code: 'recurring' });
});

/* ---------------- dispatcher against a fake iCloud ---------------- */

function fakeDb() {
  const rows = new Map();
  const client = {
    rows,
    from() {
      const q = { filter: null };
      return {
        select() { return this; },
        eq(_col, val) { q.filter = val; return this; },
        async maybeSingle() { return { data: rows.get(q.filter) || null, error: null }; },
        async upsert(row) { rows.set(row.user_id, { ...row }); return { error: null }; },
        delete() { return { eq: async (_c, val) => { rows.delete(val); return { error: null }; } }; },
      };
    },
  };
  return client;
}

let realFetch;
let store;
let calls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  store = new Map([[`${WORK}one.ics`, { etag: '"v1"', ics: vcal('BEGIN:VEVENT', 'UID:one', 'DTSTART:20261117T150000Z', 'DTEND:20261117T160000Z', 'SUMMARY:Dentist', 'END:VEVENT') }]]);
  const ms = (inner) => new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:">${inner}</multistatus>`, { status: 207 });
  const empty = (status, headers) => new Response(null, { status, headers });
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers || {} });
    const auth = init.headers?.authorization;
    if (auth !== `Basic ${Buffer.from('me@icloud.com:abcdefghijklmnop').toString('base64')}`) return empty(401);
    if (url === 'https://caldav.icloud.com/' && method === 'PROPFIND') {
      return empty(301, { location: 'https://caldav.icloud.com/principal-root/' });
    }
    if (url === 'https://caldav.icloud.com/principal-root/') {
      return ms('<response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response>');
    }
    if (url === 'https://caldav.icloud.com/123/principal/') {
      return ms(`<response><href>/123/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p52-caldav.icloud.com:443/123/calendars/</href></calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);
    }
    if (url === HOME && method === 'PROPFIND') return new Response(calendarsXml, { status: 207 });
    if (method === 'REPORT') {
      const items = [...store].filter(([href]) => href.startsWith(url)).map(([href, r]) =>
        `<response><href>${new URL(href).pathname}</href><propstat><prop><getetag>${r.etag}</getetag><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${r.ics.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);
      return ms(items.join(''));
    }
    const item = store.get(url);
    if (method === 'GET') return item ? new Response(item.ics, { headers: { etag: item.etag } }) : empty(404);
    if (method === 'PUT') {
      if (init.headers['if-none-match'] === '*' && item) return empty(412);
      if (init.headers['if-match'] && init.headers['if-match'] !== item?.etag) return empty(412);
      const etag = `"v${Math.random().toString(36).slice(2, 7)}"`;
      store.set(url, { etag, ics: init.body });
      return empty(item ? 204 : 201, { etag });
    }
    if (method === 'DELETE') {
      if (!item) return empty(404);
      if (init.headers['if-match'] && init.headers['if-match'] !== item.etag) return empty(412);
      store.delete(url);
      return empty(204);
    }
    return empty(400);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const verify = async (t) => (t === 'good' ? { id: 'user-1' } : null);
const call = (client, path, body, method = body === undefined ? 'GET' : 'POST', token = 'good') =>
  handleCaldavRequest(
    new Request(`http://localhost/api/caldav/${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }),
    { client, verify }
  ).then(async (r) => ({ status: r.status, body: await r.json() }));

test('connect → list → create → update → move → delete against iCloud', async () => {
  const db = fakeDb();
  assert.deepEqual((await call(db, 'status')).body, { connected: false, configured: true, username: null });
  assert.equal((await call(db, 'status', undefined, 'GET', 'nope')).status, 401);

  const bad = await call(db, 'connect', { username: 'me@icloud.com', password: 'wrongwrongwrongw' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.code, 'auth');

  const ok = await call(db, 'connect', { username: 'me@icloud.com', password: 'abcd efgh ijkl mnop' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.calendars.map((c) => c.name), ['Work & School', 'Family']);
  const row = db.rows.get('user-1');
  assert.equal(row.home_url, HOME);
  assert.ok(!row.secret.includes('abcdefghijklmnop'));
  assert.equal((await call(db, 'status')).body.username, 'me@icloud.com');

  const list = await call(db, 'list', { timeMin: '2026-11-16T00:00:00Z', timeMax: '2026-11-23T00:00:00Z', tz: 'America/New_York' });
  assert.equal(list.status, 200);
  const dentist = list.body.events.find((e) => e.title === 'Dentist');
  assert.equal(dentist.editable, true);

  const created = await call(db, 'create', { event: { cal_id: WORK, title: 'Gym', starts_at: '2026-11-18T12:00:00Z', ends_at: '2026-11-18T13:00:00Z' } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(created.body.href.startsWith(WORK) && created.body.href.endsWith('.ics'));
  assert.match(store.get(created.body.href).ics, /SUMMARY:Gym/);
  assert.equal(calls.find((c) => c.method === 'PUT').headers['if-none-match'], '*');

  const stale = await call(db, 'update', { event: { href: dentist.href, etag: '"old"', title: 'Dentist', starts_at: dentist.starts_at } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');

  const updated = await call(db, 'update', { event: { href: dentist.href, etag: dentist.etag, title: 'Dentist (moved)', starts_at: '2026-11-17T18:00:00Z', ends_at: '2026-11-17T19:00:00Z' } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.match(store.get(dentist.href).ics, /SUMMARY:Dentist \(moved\)/);
  assert.match(store.get(dentist.href).ics, /DTSTART:20261117T180000Z/);

  const moved = await call(db, 'update', { event: { href: dentist.href, title: 'Dentist (moved)', starts_at: '2026-11-17T18:00:00Z', cal_id: HOMECAL } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.href, `${HOMECAL}one.ics`);
  assert.ok(!store.has(dentist.href) && store.has(`${HOMECAL}one.ics`));

  const outside = await call(db, 'delete', { href: 'https://p52-caldav.icloud.com/999/calendars/work/x.ics' });
  assert.equal(outside.status, 400);
  assert.equal(outside.body.code, 'bad_href');

  assert.equal((await call(db, 'delete', { href: created.body.href, etag: created.body.etag })).status, 200);
  assert.ok(!store.has(created.body.href));

  assert.equal((await call(db, 'disconnect', {})).status, 200);
  assert.equal((await call(db, 'list', {})).body.code, 'not_connected');
});
