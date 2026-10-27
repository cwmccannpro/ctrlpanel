import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyUserToken } from './google.js';

// Shared by Express and Workers. The Mac connects OUT, never accepts cloud
// traffic. Bridge secrets and snapshots are service-role-only in Postgres.
let client;
function db() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) fail(503, 'Room Control needs the server’s Supabase configuration.');
  return client ||= createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
const hash = (key) => createHash('sha256').update(key).digest('hex');
function check(result) { if (result.error) fail(503, 'Room storage is unavailable. Apply docs/room-control.sql and check the server configuration.'); return result.data; }
export function roomOnline(row, now = Date.now()) {
  return Boolean(row?.last_seen_at && now - Date.parse(row.last_seen_at) < 15000 && !row.snapshot?.controller_error);
}

// Both sides enforce this list; a bridge can never be used as an arbitrary
// HTTP proxy, filesystem interface, or shell executor.
export function validRoomAction(method, path) {
  const id = '[A-Za-z0-9_-]{1,100}';
  return [
    ['POST', '^/(room/command|scan|alarm/(stop|preview)|presets|schedules)$'],
    ['POST', `^/devices/${id}/command$`],
    ['POST', `^/presets/${id}/apply$`],
    ['POST', `^/inspect/${id}$`],
    ['PUT', `^/(devices|schedules)/${id}$`],
    ['DELETE', `^/(devices|presets|schedules)/${id}$`],
  ].some(([m, pattern]) => method === m && new RegExp(pattern).test(path));
}
export function publicRoomSnapshot(input) {
  const snapshot = {};
  for (const key of ['devices', 'presets', 'schedules', 'history', 'nearby', 'last_scan', 'scan_error', 'timezone', 'now', 'controller_error']) {
    if (input?.[key] !== undefined) snapshot[key] = input[key];
  }
  const alarm = input?.alarm || {};
  snapshot.alarm = Object.fromEntries(Object.entries(alarm).filter(([key]) => key !== 'previous_audio'));
  if (JSON.stringify(snapshot).length > 180000) fail(413, 'Room snapshot is too large.');
  return snapshot;
}

async function connection(userId) {
  return check(await db().from('room_connections').select('*').eq('user_id', userId).maybeSingle());
}
async function bridge(key) {
  if (!/^ctrb_[a-f0-9]{64}$/.test(key)) fail(401, 'Invalid room bridge key.');
  const row = check(await db().from('room_connections').select('*').eq('key_hash', hash(key)).maybeSingle());
  if (!row) fail(401, 'Room bridge key was revoked. Connect this Mac again.');
  return row;
}

export async function handleRoomRequest(method, path, token, body = {}) {
  try {
    if (path === '/bridge/sync' && method === 'POST') {
      const row = await bridge(token);
      const snapshot = publicRoomSnapshot(body.snapshot);
      // A rotated key cannot publish over the replacement connection.
      const updated = check(await db().from('room_connections').update({ snapshot, last_seen_at: new Date().toISOString() })
        .eq('id', row.id).eq('key_hash', row.key_hash).select('id').maybeSingle());
      if (!updated) fail(401, 'Room bridge key was revoked.');
      // Results can be re-acknowledged after a network failure, never replayed.
      for (const result of (Array.isArray(body.results) ? body.results : []).slice(0, 20)) {
        if (!/^[a-f0-9-]{36}$/i.test(result.id || '')) continue;
        check(await db().from('room_commands').update({ status: result.error ? 'failed' : 'done',
          result: result.data ?? null, error: String(result.error || '').slice(0, 2000) || null })
          .eq('id', result.id).eq('connection_id', row.id).eq('status', 'running'));
      }
      // One claimed operation at a time, with a short expiry. The DB function
      // uses SKIP LOCKED, so parallel syncs cannot dispatch the same command.
      const commands = snapshot.controller_error ? [] : check(await db().rpc('claim_room_command', { bridge_id: row.id, bridge_hash: row.key_hash, bridge_busy: !!body.busy }));
      return { body: { commands: commands || [] } };
    }

    const user = token ? await verifyUserToken(token) : null;
    if (!user) fail(401, 'Sign in to control your room.');
    if (path === '/connection' && method === 'POST') {
      const key = `ctrb_${randomBytes(32).toString('hex')}`;
      // Delete cancels all queued commands by FK cascade. No old snapshot or
      // stale queued actions survive a reconnect / key rotation.
      check(await db().from('room_connections').delete().eq('user_id', user.id));
      check(await db().from('room_connections').insert({ user_id: user.id, key_hash: hash(key) }));
      return { body: { key } };
    }
    if (path === '/connection' && method === 'DELETE') {
      check(await db().from('room_connections').delete().eq('user_id', user.id));
      return { body: { ok: true } };
    }
    const row = await connection(user.id);
    if (path === '/status' && method === 'GET') {
      return { body: { paired: !!row, online: roomOnline(row), last_seen_at: row?.last_seen_at || null, snapshot: row?.snapshot || null } };
    }
    if (!row) fail(409, 'Connect your Mac first.');
    if (path === '/commands' && method === 'POST') {
      if (!roomOnline(row)) fail(409, 'Your room controller is offline. Start Room Control and its bridge on your Mac.');
      if (!validRoomAction(body.method, body.path)) fail(400, 'Unsupported room action.');
      if (!/^[a-f0-9-]{36}$/i.test(body.id || '')) fail(400, 'A command ID is required.');
      if (JSON.stringify(body.body || {}).length > 12000) fail(413, 'Room command is too large.');
      const pending = check(await db().from('room_commands').select('id').eq('connection_id', row.id)
        .in('status', ['pending', 'running']).gt('expires_at', new Date().toISOString()).limit(20));
      if (pending.length >= 20) fail(429, 'Wait for the current room actions to finish.');
      const result = await db().from('room_commands').insert({ id: body.id, connection_id: row.id,
        method: body.method, path: body.path, body: body.body || {}, expires_at: new Date(Date.now() + 20000).toISOString() }).select('id').single();
      if (result.error?.code === '23505') {
        const existing = check(await db().from('room_commands').select('id').eq('id', body.id).eq('connection_id', row.id).maybeSingle());
        if (!existing) fail(409, 'Command ID is already in use.');
        return { body: existing };
      }
      return { body: check(result) };
    }
    const match = path.match(/^\/commands\/([a-f0-9-]{36})$/i);
    if (match && method === 'GET') {
      const command = check(await db().from('room_commands').select('id,status,result,error,expires_at,started_at')
        .eq('id', match[1]).eq('connection_id', row.id).maybeSingle());
      if (!command) fail(404, 'Room command not found.');
      if (command.status === 'pending' && Date.parse(command.expires_at) < Date.now()) command.status = 'expired';
      if (command.status === 'running' && Date.parse(command.started_at) < Date.now() - 180000) command.status = 'unknown';
      return { body: command };
    }
    fail(404, 'Room endpoint not found.');
  } catch (error) {
    return { status: error.status || 500, body: { error: error.message || 'Room request failed.' } };
  }
}
