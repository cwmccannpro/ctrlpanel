import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRoomRequest, publicRoomSnapshot, roomOnline, validRoomAction } from '../backend/room.js';

test('room proxy permits every supported controller action but cannot become an arbitrary HTTP proxy', () => {
  for (const [method, path] of [
    ['POST', '/room/command'], ['POST', '/scan'], ['POST', '/alarm/preview'], ['POST', '/alarm/stop'],
    ['POST', '/presets'], ['POST', '/schedules'], ['POST', '/inspect/819A9159-4FC9-8426-D880-58C1AA33114D'],
    ['POST', '/devices/lamp-1/command'], ['POST', '/presets/night/apply'], ['PUT', '/devices/bar'],
    ['PUT', '/schedules/wake'], ['DELETE', '/schedules/wake'], ['DELETE', '/presets/night'], ['DELETE', '/devices/bar'],
  ]) assert.equal(validRoomAction(method, path), true, `${method} ${path}`);
  for (const path of ['/../state', '/devices/../../alarm/preview', 'https://evil.example', '/static/app.js',
    '/room/command?host=evil', '/devices/%2e%2e/command', '/devices/bar/command/extra', '/api/state']) {
    assert.equal(validRoomAction('POST', path), false, path);
  }
  assert.equal(validRoomAction('GET', '/room/command'), false);
});

test('offline, stale, and broken local controllers cannot claim to be connected', () => {
  const now = Date.now();
  assert.equal(roomOnline({ last_seen_at: new Date(now).toISOString(), snapshot: {} }, now), true);
  assert.equal(roomOnline({ last_seen_at: new Date(now - 16000).toISOString() }, now), false);
  assert.equal(roomOnline({ last_seen_at: new Date(now).toISOString(), snapshot: { controller_error: 'Offline' } }, now), false);
  assert.equal(roomOnline(null, now), false);
});

test('published state excludes saved audio output preferences and private controller internals', () => {
  const output = publicRoomSnapshot({ devices: [], presets: [], alarm_runtime: { previous_audio: 'private' },
    alarm: { active: true, label: 'Wake', previous_audio: { device_id: 'private' } }, removed_devices: ['bed'] });
  assert.deepEqual(output, { devices: [], presets: [], alarm: { active: true, label: 'Wake' } });
  assert.throws(() => publicRoomSnapshot({ history: ['x'.repeat(180001)] }), /too large/);
});

test('unauthenticated room endpoints fail closed before touching storage', async () => {
  for (const [method, path] of [['GET','/status'], ['POST','/connection'], ['DELETE','/connection'], ['POST','/commands']]) {
    assert.equal((await handleRoomRequest(method, path, '')).status, 401);
  }
  assert.equal((await handleRoomRequest('POST', '/bridge/sync', 'invalid')).status, 401);
});
