import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleRoomRequest } from '../backend/room.js';
import { roomOnline, validateRoomCommand } from '../src/lib/roomControl.js';

const devices = [{ id: 'bulb1', cct: true }, { id: 'bulb2', cct: true }, { id: 'bar', cct: false }];
const owner = 'aa605c35-fc52-485c-9fe4-84aad8c6f2e7';
const bridgeKey = `ctrb_${'a'.repeat(64)}`;
const request = (path, token, body, method = body === undefined ? 'GET' : 'POST') => new Request(`https://ctrlpanel.cwmccann.pro/api/room/${path}`, {
  method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function mock() {
  const calls = [];
  return { calls, verify: async token => token === 'owner-session' ? { id: owner } : token === 'other-session' ? { id: 'other-user' } : null,
    client: { rpc: async (name, args) => {
      calls.push({ name, ...args });
      if (args.p_user && args.p_user !== owner) return { error: { code: '42501', message: 'No room controller is linked to this account.' } };
      return { data: args.p_action === 'status' ? { controller: { devices } } : { ok: true } };
    } },
  };
}
test('whole-room temperature targets bulbs only; color/power reach all configured lights', () => {
  assert.deepEqual(validateRoomCommand({ target: 'all', patch: { temperature: 2700 } }, devices).targets, ['bulb1','bulb2']);
  assert.deepEqual(validateRoomCommand({ target: 'all', patch: { power: false } }, devices).targets, ['bulb1','bulb2','bar']);
  assert.equal(validateRoomCommand({ target: 'bulb1', patch: { color: '#ABCDEF' } }, devices).patch.color, '#abcdef');
});
test('invalid settings, arbitrary addresses, duplicate fields and unsupported temperature are rejected', () => {
  for (const body of [null, [], { target: '08:65:F0:29:CC:F3', patch: { power: true } },
    { target: 'all', patch: { brightness: 101 } }, { target: 'all', patch: { brightness: '50' } },
    { target: 'all', patch: { brightness: 0 } }, { target: 'all', patch: { power: 'true' } },
    { target: 'all', patch: { color: '#abc' } }, { target: 'bar', patch: { temperature: 3500 } },
    { target: 'all', patch: { temperature: 6501 } }, { target: 'all', patch: { raw: '123' } },
    { target: 'all', patch: { power: true, brightness: 50 } }, { target: 'all', patch: { power: true }, user_id: owner },
  ]) assert.throws(() => validateRoomCommand(body, devices));
});
test('online requires a live paired heartbeat', () => {
  const now = Date.now();
  assert.equal(roomOnline({ paired: true, last_seen: new Date(now - 29000).toISOString() }, now), true);
  assert.equal(roomOnline({ paired: true, last_seen: new Date(now - 31000).toISOString() }, now), false);
  assert.equal(roomOnline({ paired: false, last_seen: new Date(now).toISOString() }, now), false);
});
test('every route rejects absent/query-only tokens before touching storage', async () => {
  for (const path of ['status?token=owner-session', 'command', 'pair', 'revoke', 'bridge/poll', 'bridge/ack']) {
    const deps = mock();
    assert.equal((await handleRoomRequest(request(path, null, path.startsWith('status') ? undefined : {}), deps)).status, 401);
    assert.equal(deps.calls.length, 0);
  }
});
test('bridge key cannot issue commands or rotate keys; session cannot impersonate bridge', async () => {
  for (const path of ['command', 'preset', 'pair', 'revoke']) {
    const deps = mock();
    assert.equal((await handleRoomRequest(request(path, bridgeKey, {}), deps)).status, 401);
    assert.equal(deps.calls.length, 0);
  }
  assert.equal((await handleRoomRequest(request('bridge/poll', 'owner-session', {}), mock())).status, 401);
});
test('presets require a known name and pass only the verified owner to the queue', async () => {
  const deps = mock();
  const invalid = await handleRoomRequest(request('preset', 'owner-session', { preset: 'other' }), deps);
  assert.equal(invalid.status, 400);
  assert.equal(deps.calls.length, 0);
  const accepted = await handleRoomRequest(request('preset', 'owner-session', { preset: 'work', user_id: 'another-user' }), deps);
  assert.equal(accepted.status, 202);
  assert.deepEqual(deps.calls[0], { name: 'room_apply_preset', p_user: owner, p_preset: 'work' });
});
test('ownership comes only from verified user; other account is denied', async () => {
  const deps = mock();
  assert.equal((await handleRoomRequest(request('pair', 'other-session', { user_id: owner }), deps)).status, 403);
  assert.equal(deps.calls[0].p_user, 'other-user');
});
test('bridge sends only the SHA256 credential hash to storage', async () => {
  const deps = mock();
  assert.equal((await handleRoomRequest(request('bridge/poll', bridgeKey, { user_id: owner }), deps)).status, 200);
  assert.equal(deps.calls[0].p_user, null);
  assert.equal(deps.calls[0].p_hash, createHash('sha256').update(bridgeKey).digest('hex'));
  assert.deepEqual(deps.calls[0].p_body, {});
});
test('command validates before enqueue and returns accepted, never false success', async () => {
  const deps = mock();
  const response = await handleRoomRequest(request('command', 'owner-session', { target: 'all', patch: { temperature: 3500 } }), deps);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(deps.calls[1].p_body.targets, ['bulb1','bulb2']);
  const bad = mock();
  assert.equal((await handleRoomRequest(request('command', 'owner-session', { target: 'all', patch: { brightness: 999 } }), bad)).status, 400);
  assert.equal(bad.calls.length, 1);
});
test('database failure closes access and oversized requests are rejected', async () => {
  const deps = mock(); deps.client.rpc = async () => ({ error: { code: 'XX000', message: 'private details' } });
  const res = await handleRoomRequest(request('status', 'owner-session'), deps);
  assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /private details/);
  const big = mock();
  assert.equal((await handleRoomRequest(request('command', 'owner-session', { filler: 'a'.repeat(17000) }), big)).status, 413);
  assert.equal(big.calls.length, 0);
});
test('schema source contains identical additive migration, no browser access', () => {
  const migration = readFileSync(new URL('../migrations/20261115-room-control.sql', import.meta.url), 'utf8');
  assert.ok(readFileSync(new URL('../supabase-schema.sql', import.meta.url), 'utf8').replaceAll('\r\n','\n').includes(migration.replaceAll('\r\n','\n').trim()));
  assert.match(migration, /revoke all on function public.room_relay.*from public,anon,authenticated/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /for update/);
});
