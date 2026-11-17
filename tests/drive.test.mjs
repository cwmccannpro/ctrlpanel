import test from 'node:test';
import assert from 'node:assert/strict';
import { driveAccess, driveAccessNotice, drivePreferences, driveSummary, swipePage, sendDriveCommand, driveRequest, driveImage, driveSeek, turnKind, trackProgress, trackTime, TURN_KINDS, DRIVE_PAGES, DRIVE_SECTIONS, DRIVE_FACES, DRIVE_THEMES } from '../src/lib/drive.js';
import { loadDriveSnapshot } from '../src/lib/driveSnapshot.js';
import { driveMapStyle, driveHeading, currentDriveLocation } from '../src/lib/driveMap.js';

function snapshotClient(responses, calls = []) {
  return { from(table) {
    const call = { table }; calls.push(call);
    const query = { select() { return query; }, order() { return query; }, eq(key, value) { call.filter = [key, value]; return query; }, limit(value) { call.limit = value; return query; }, abortSignal(signal) { call.signal = signal; return Promise.resolve(responses[table] || { data: [], error: null }); } };
    return query;
  } };
}
test('snapshot exposes partial coverage and bounds data without changing the source', async () => {
  const rows = Array.from({ length: 501 }, (_, id) => ({ id }));
  const calls = [];
  const controller = new AbortController();
  const result = await loadDriveSnapshot(snapshotClient({ tasks: { data: rows } }, calls), controller.signal, new Date(2026, 10, 15, 23));
  assert.equal(result.partial, true);
  assert.equal(result.data.tasks.length, 500);
  assert.equal(rows.length, 501);
  assert.deepEqual(calls.find(c => c.table === 'habit_logs').filter, ['log_date', '2026-11-15']);
  assert.ok(calls.every(c => c.signal === controller.signal && c.limit === 501));
});
test('exactly 500 rows is complete; a failed or absent source never yields a successful snapshot', async () => {
  const client = snapshotClient({ tasks: { data: Array.from({ length: 500 }, (_, id) => ({ id })) } });
  assert.equal((await loadDriveSnapshot(client, new AbortController().signal)).partial, false);
  await assert.rejects(loadDriveSnapshot(snapshotClient({ boards: { error: new Error('Offline') } }), new AbortController().signal), /Offline/);
  await assert.rejects(loadDriveSnapshot(snapshotClient({ habits: { data: null } }), new AbortController().signal), /Incomplete/);
});
test('cancelled requests cannot publish even if a transport completes after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadDriveSnapshot(snapshotClient({}), controller.signal), /cancelled/);
});

test('swipes require intentional horizontal travel and stop at the ends', () => {
  assert.equal(swipePage(0, -100, 12), 1);
  assert.equal(swipePage(1, 100, 12), 0);
  assert.equal(swipePage(0, 100, 0), 0);
  assert.equal(swipePage(DRIVE_PAGES.length - 1, -100, 0), DRIVE_PAGES.length - 1);
  assert.equal(swipePage(1, -40, 0), 1);
  assert.equal(swipePage(1, -100, 90), 1);
});
test('summary respects custom board completion and only todayâ€™s active habits', () => {
  const result = driveSummary({
    boards: [{ id: 'b', columns: ['Queue', 'Working', 'Shipped'] }],
    tasks: [{ id: 'a', board_id: 'b', column_name: 'Shipped', due_date: '2026-11-14' },
      { id: 'b', column_name: 'Backlog', due_date: '2026-11-15' },
      { id: 'c', column_name: 'Backlog', due_date: '2026-11-16' }],
    habits: [{ id: 'h', active: true }, { id: 'old', active: false }],
    logs: [{ habit_id: 'h', log_date: '2026-11-14', completed: true }, { habit_id: 'old', log_date: '2026-11-15', completed: true }],
  }, new Date(2026, 10, 15, 23));
  assert.deepEqual(result.due.map(t => t.id), ['b']);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.habits.length, 1);
  assert.equal(result.completed, 0);
});
test('unrecognized settings and arbitrary native commands are rejected', () => {
  assert.equal(drivePreferences({ face: '<script>' }).face, 'digital');
  assert.equal(drivePreferences(null).face, 'digital');
  assert.equal(drivePreferences({ face: 'analog' }).face, 'analog');
  assert.equal(sendDriveCommand('intent://untrusted'), false);
});
test('all top-level CTRLpanel sections have destinations and display choices normalize independently', () => {
  const paths = DRIVE_SECTIONS.map(s => s.to);
  for (const path of ['/', '/calendar', '/todo', '/knowledge', '/habits', '/health', '/room', '/finance', '/review', '/crm', '/agents', '/projects', '/socials', '/settings']) assert.ok(paths.includes(path));
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(DRIVE_FACES.length, 13);
  assert.equal(DRIVE_THEMES.length, 6);
  assert.deepEqual(drivePreferences({ face: 'maps', theme: 'bad', accent: 'url(evil)' }), { face: 'maps', theme: 'amoled', accent: '#e11d48' });
});
test('voice requests accept only bounded plain text for explicit commands', () => {
  assert.deepEqual(driveRequest('navigate', '  Coffee shop  '), { command: 'navigate', query: 'Coffee shop' });
  assert.equal(driveRequest('exec', 'something'), null);
  assert.equal(driveRequest('musicSearch', ''), null);
  assert.equal(driveRequest('musicSearch', 'x'.repeat(201)), null);
  assert.equal(driveRequest('navigate', 'test\ncommand'), null);
});
test('map refuses stale, invalid and future location rather than fabricating a fix', () => {
  const point = { latitude: 40, longitude: -74, timestamp: 100000 };
  assert.equal(currentDriveLocation(point, 110000), point);
  assert.equal(currentDriveLocation(point, 161000), null);
  assert.equal(currentDriveLocation(point, 90000), null);
  assert.equal(currentDriveLocation({ ...point, latitude: 91 }, 110000), null);
  assert.equal(currentDriveLocation({ ...point, longitude: NaN }, 110000), null);
});
test('map style follows the theme and uses a fixed HTTPS OpenFreeMap style', () => {
  assert.equal(driveMapStyle(false), 'https://tiles.openfreemap.org/styles/dark');
  assert.equal(driveMapStyle(true), 'https://tiles.openfreemap.org/styles/liberty');
});
test('the heading marker only turns while moving and normalizes the bearing', () => {
  assert.equal(driveHeading({ bearing: 90, speed: 10 }), 90);
  assert.equal(driveHeading({ bearing: -90, speed: 10 }), 270);
  assert.equal(driveHeading({ bearing: 90, speed: 0.3 }), null);
  assert.equal(driveHeading({ bearing: NaN, speed: 10 }), null);
  assert.equal(driveHeading(null), null);
});
test('Drive pages: Dashboard first, Map right after All sections', () => {
  assert.deepEqual(DRIVE_PAGES, ['Dashboard', 'All sections', 'Map', 'Music']);
});
test('only inline PNG/JPEG data from the Android app is shown as an image', () => {
  assert.equal(driveImage('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  assert.equal(driveImage('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  for (const bad of ['https://evil.example/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'data:image/png;base64,abc")', 'javascript:alert(1)', null, 42]) assert.equal(driveImage(bad), null);
  assert.equal(driveImage(`data:image/png;base64,${'A'.repeat(700000)}`), null);
});
test('turn arrows follow the Google Maps instruction', () => {
  const cases = { 'Turn right onto W 44th St': 'right', 'Turn left': 'left', 'Slight left toward I-95': 'slight-left', 'Keep right at the fork': 'slight-right', 'Take exit 12 toward Newark': 'slight-right', 'Sharp right onto Elm': 'sharp-right', 'Make a U-turn': 'uturn', 'At the roundabout, take the 2nd exit': 'roundabout', 'Merge onto I-80 W': 'merge', 'Continue onto Main St': 'straight', 'Head north': 'straight', 'Arrive at destination': 'arrive', 'Your destination is on the left': 'arrive' };
  for (const [text, kind] of Object.entries(cases)) assert.equal(turnKind('0.3 mi', text), kind, text);
  assert.ok(Object.values(cases).every(k => TURN_KINDS.includes(k)));
  assert.equal(turnKind(), 'straight');
});
test('track progress runs on only while playing and never passes the end', () => {
  const at = 1000000;
  assert.deepEqual(trackProgress({ duration: 200000, position: 50000, playing: true, at }, at + 10000), { elapsed: 60000, duration: 200000, remaining: 140000, fraction: 0.3 });
  assert.equal(trackProgress({ duration: 200000, position: 50000, playing: false, at }, at + 10000).elapsed, 50000);
  assert.equal(trackProgress({ duration: 200000, position: 195000, playing: true, at }, at + 60000).elapsed, 200000);
  assert.equal(trackProgress({ duration: 0, position: 5 }), null);
  assert.equal(trackProgress(null), null);
  assert.equal(trackTime(83000), '1:23');
  assert.equal(trackTime(3725000), '1:02:05');
  assert.equal(trackTime(-5), '0:00');
});
test('seek requests are whole milliseconds within a day, nothing else', () => {
  assert.deepEqual(driveSeek(83500.4), { command: 'seek', position: 83500 });
  assert.deepEqual(driveSeek(0), { command: 'seek', position: 0 });
  for (const bad of [-1, 86400001, NaN, Infinity, 'abc', null]) assert.equal(driveSeek(bad), null);
});

test('notification access state: browser, off, unsupported, reconnecting and ready', () => {
  assert.equal(driveAccess({ available: false }), 'browser');
  assert.equal(driveAccess({ available: true, access: false }), 'off');
  assert.equal(driveAccess({ available: true, access: false, supported: false }), 'unsupported');
  assert.equal(driveAccess({ available: true, access: true, connected: false }), 'connecting');
  assert.equal(driveAccess({ available: true, access: true, connected: true }), 'ready');
  // An older APK sends only access (= connected).
  assert.equal(driveAccess({ available: true, access: true }), 'ready');
});
test('empty cards explain missing notification access; Spotify does not wait for the Maps listener', () => {
  assert.equal(driveAccessNotice('ready', 'maps'), null);
  assert.equal(driveAccessNotice('browser', 'music'), null);
  assert.equal(driveAccessNotice('off', 'maps').action, true);
  assert.match(driveAccessNotice('off', 'music').text, /notification access/);
  assert.equal(driveAccessNotice('unsupported', 'maps').action, false);
  assert.ok(driveAccessNotice('connecting', 'maps'));
  assert.equal(driveAccessNotice('connecting', 'music'), null);
});
