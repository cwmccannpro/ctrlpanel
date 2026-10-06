import assert from 'node:assert/strict';
import { test } from 'node:test';
import { icalEvents, icsToEvents, normalizeFeedUrl, naiveToInstant } from '../backend/ical.js';

const wrap = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Home\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const vevent = (...lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const run = (text, from, to, extra = {}) =>
  icsToEvents(text, { from: Date.parse(from), to: Date.parse(to), tz: 'America/New_York', feedId: 'f', ...extra }).events;

test('a zoned timed event becomes the right UTC instant', () => {
  const ics = wrap(vevent('UID:a', 'DTSTART;TZID=America/New_York:20261006T090000', 'DTEND;TZID=America/New_York:20261006T100000', 'SUMMARY:Standup'));
  const [e] = run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.equal(e.title, 'Standup');
  assert.equal(e.starts_at, '2026-10-06T13:00:00.000Z'); // EDT = UTC-4
  assert.equal(e.ends_at, '2026-10-06T14:00:00.000Z');
  assert.equal(e.all_day, false);
  assert.equal(e.calendar, 'Home');
});

test('UTC, floating and Windows-named zones', () => {
  const ics = wrap(
    vevent('UID:u', 'DTSTART:20261006T150000Z', 'SUMMARY:UTC'),
    vevent('UID:f', 'DTSTART:20261006T090000', 'SUMMARY:Floating'),
    vevent('UID:w', 'DTSTART;TZID=Eastern Standard Time:20261006T090000', 'SUMMARY:Windows'),
  );
  const by = Object.fromEntries(run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z').map((e) => [e.title, e.starts_at]));
  assert.equal(by.UTC, '2026-10-06T15:00:00.000Z');
  assert.equal(by.Floating, '2026-10-06T13:00:00.000Z'); // viewer's zone
  assert.equal(by.Windows, '2026-10-06T13:00:00.000Z');
});

test('all-day events use an exclusive end and span days', () => {
  const ics = wrap(vevent('UID:a', 'DTSTART;VALUE=DATE:20261007', 'DTEND;VALUE=DATE:20261010', 'SUMMARY:Trip'));
  const [e] = run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.equal(e.all_day, true);
  assert.equal(e.starts_at, '2026-10-07');
  assert.equal(e.ends_at, '2026-10-10');
});

test('folded lines and escaped text are decoded', () => {
  const ics = wrap(vevent('UID:a', 'DTSTART;VALUE=DATE:20261007', 'SUMMARY:Lunch\\, with\\nteam ', ' and more', 'LOCATION:Room 1\\;Floor 2'));
  const [e] = run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.equal(e.title, 'Lunch, with\nteam and more');
  assert.equal(e.location, 'Room 1;Floor 2');
});

test('weekly BYDAY expands only inside the window and honours EXDATE', () => {
  const ics = wrap(vevent(
    'UID:w', 'DTSTART;TZID=America/New_York:20260105T180000', 'DTEND;TZID=America/New_York:20260105T190000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=America/New_York:20261007T180000', 'SUMMARY:Gym',
  ));
  const evs = run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  // Mon 10/5 and Mon 10/12 is outside; Wed 10/7 is excluded.
  assert.deepEqual(evs.map((e) => e.starts_at), ['2026-10-05T22:00:00.000Z']);
});

test('recurring wall-clock time stays put across a DST change', () => {
  const ics = wrap(vevent('UID:d', 'DTSTART;TZID=America/New_York:20261026T090000', 'DTEND;TZID=America/New_York:20261026T093000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Sync'));
  const evs = run(ics, '2026-10-26T00:00:00Z', '2026-11-10T00:00:00Z');
  assert.deepEqual(evs.map((e) => e.starts_at), [
    '2026-10-26T13:00:00.000Z', // EDT
    '2026-11-02T14:00:00.000Z', // EST — still 9:00 local
    '2026-11-09T14:00:00.000Z',
  ]);
});

test('COUNT and UNTIL stop a series', () => {
  const count = wrap(vevent('UID:c', 'DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:C'));
  assert.deepEqual(run(count, '2026-10-01T00:00:00Z', '2026-10-30T00:00:00Z').map((e) => e.starts_at), ['2026-10-05', '2026-10-06', '2026-10-07']);
  const until = wrap(vevent('UID:u', 'DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=DAILY;UNTIL=20261006', 'SUMMARY:U'));
  assert.deepEqual(run(until, '2026-10-01T00:00:00Z', '2026-10-30T00:00:00Z').map((e) => e.starts_at), ['2026-10-05', '2026-10-06']);
});

test('monthly ordinal weekdays (first Monday, last Friday)', () => {
  const first = wrap(vevent('UID:m', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=MONTHLY;BYDAY=1MO', 'SUMMARY:First'));
  assert.deepEqual(run(first, '2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z').map((e) => e.starts_at), ['2026-10-05', '2026-11-02', '2026-12-07']);
  const last = wrap(vevent('UID:l', 'DTSTART;VALUE=DATE:20260130', 'RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', 'SUMMARY:Last'));
  assert.deepEqual(run(last, '2026-10-01T00:00:00Z', '2026-11-30T00:00:00Z').map((e) => e.starts_at), ['2026-10-30', '2026-11-27']);
});

test('yearly birthdays recur', () => {
  const ics = wrap(vevent('UID:y', 'DTSTART;VALUE=DATE:19900308', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'));
  assert.deepEqual(run(ics, '2027-03-01T00:00:00Z', '2027-03-31T00:00:00Z').map((e) => e.starts_at), ['2027-03-08']);
});

test('a RECURRENCE-ID override replaces one occurrence; a cancelled one removes it', () => {
  const ics = wrap(
    vevent('UID:s', 'DTSTART;TZID=America/New_York:20261005T100000', 'DTEND;TZID=America/New_York:20261005T110000', 'RRULE:FREQ=DAILY;COUNT=4', 'SUMMARY:Series'),
    vevent('UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261006T100000', 'DTSTART;TZID=America/New_York:20261006T140000', 'DTEND;TZID=America/New_York:20261006T150000', 'SUMMARY:Moved'),
    vevent('UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261007T100000', 'DTSTART;TZID=America/New_York:20261007T100000', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
  );
  const evs = run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.deepEqual(evs.map((e) => `${e.title}@${e.starts_at}`), [
    'Series@2026-10-05T14:00:00.000Z',
    'Moved@2026-10-06T18:00:00.000Z',
    'Series@2026-10-08T14:00:00.000Z',
  ]);
});

test('cancelled events and events outside the window are dropped; alarms are ignored', () => {
  const ics = wrap(
    vevent('UID:x', 'DTSTART:20261006T150000Z', 'STATUS:CANCELLED', 'SUMMARY:No'),
    vevent('UID:y', 'DTSTART:20270106T150000Z', 'SUMMARY:Later'),
    vevent('UID:z', 'DTSTART:20261006T150000Z', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'SUMMARY:alarm text', 'END:VALARM', 'SUMMARY:Real'),
  );
  assert.deepEqual(run(ics, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z').map((e) => e.title), ['Real']);
});

test('naiveToInstant handles the spring-forward gap and fall-back overlap deterministically', () => {
  const naive = Date.UTC(2026, 10, 1, 9, 0, 0); // after the Nov 1 2026 fall-back
  assert.equal(new Date(naiveToInstant(naive, 'America/New_York')).toISOString(), '2026-11-01T14:00:00.000Z');
});

test('feed URLs: webcal is upgraded, unsafe hosts are refused', () => {
  assert.equal(normalizeFeedUrl('webcal://p123-caldav.icloud.com/published/2/abc'), 'https://p123-caldav.icloud.com/published/2/abc');
  for (const bad of ['http://example.com/a.ics', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://10.0.0.5/a.ics', 'https://intranet/a.ics', 'https://[::1]/a.ics', 'https://user:pw@example.com/a.ics', 'ftp://example.com/a.ics', '', 'not a url']) {
    assert.throws(() => normalizeFeedUrl(bad), undefined, bad);
  }
});

test('icalEvents reports a bad feed without hiding the good ones', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('good.example.com')) {
      return new Response(wrap(vevent('UID:a', 'DTSTART:20261006T150000Z', 'SUMMARY:Hi')), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  };
  try {
    const out = await icalEvents({
      timeMin: '2026-10-05T00:00:00Z', timeMax: '2026-10-12T00:00:00Z', tz: 'America/New_York',
      feeds: [
        { id: 'g', url: 'webcal://good.example.com/a.ics', label: 'Good', color: '#10b981' },
        { id: 'b', url: 'https://bad.example.com/a.ics' },
        { id: 'p', url: 'https://localhost/a.ics' },
      ],
    });
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].calendar, 'Good');
    assert.equal(out.events[0].color, '#10b981');
    assert.deepEqual(out.feeds.map((f) => [f.id, f.ok]), [['g', true], ['b', false], ['p', false]]);
    assert.match(out.feeds[1].error, /404/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a repeating event longer than its interval becomes a one-hour marker', () => {
  // Daily 6pm event whose DTEND was set a year later: must not pile up on every day.
  const ics = wrap(vevent('UID:long', 'DTSTART;TZID=America/New_York:20260401T180000', 'DTEND;TZID=America/New_York:20270331T190000', 'RRULE:FREQ=DAILY', 'SUMMARY:Plan'));
  const evs = run(ics, '2026-10-06T04:00:00Z', '2026-10-07T04:00:00Z');
  assert.deepEqual(evs.map((e) => e.starts_at), ['2026-10-06T22:00:00.000Z']);
  assert.equal(evs[0].ends_at, '2026-10-06T23:00:00.000Z'); // 1 hour long
});
