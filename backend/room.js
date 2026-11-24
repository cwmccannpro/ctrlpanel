import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyUserToken } from './google.js';
import { validateRoomCommand } from '../src/lib/roomControl.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('Room controller storage is not configured.', 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// One dispatcher for Express and Workers. Bridge credentials cannot enqueue commands.
export async function handleRoomRequest(request, { client, verify = verifyUserToken } = {}) {
  try {
    const path = new URL(request.url).pathname.slice('/api/room/'.length);
    const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) throw fail('Sign in to control your room.', 401);
    const bridge = path.startsWith('bridge/');
    if (bridge && !/^ctrb_[a-f0-9]{64}$/.test(token)) throw fail('Invalid controller credential.', 401);
    if (!bridge && token.startsWith('ctrb_')) throw fail('A user session is required.', 401);
    const user = bridge ? null : await verify(token);
    if (!bridge && !user?.id) throw fail('Sign in to control your room.', 401);
    const db = client || admin();
    let body = {};
    if (request.method === 'POST') {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 16384) throw fail('Room request is too large.', 413);
      try { body = JSON.parse(raw); } catch { throw fail('Invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('A JSON object is required.');
    }
    const readResult = ({ data, error }) => {
      if (error) {
        const statuses = { '42501': 403, '22023': 400, '55000': 409, '54000': 429 };
        throw fail(statuses[error.code] ? error.message : 'Room storage is unavailable. Check the Room Control migration.', statuses[error.code] || 503);
      }
      return data;
    };
    const rpc = async (action, payload = {}) => readResult(await db.rpc('room_relay', { p_action: action, p_user: user?.id || null, p_hash: bridge ? hash(token) : null, p_body: payload }));
    if (path === 'status' && request.method === 'GET') {
      const current = await rpc('status');
      const settings = readResult(await db.from('room_controllers').select('preset_schedule_enabled').eq('user_id', user.id).maybeSingle());
      return json({ ...current, presetScheduleEnabled: settings?.preset_schedule_enabled === true });
    }
    if (path === 'preset' && request.method === 'POST') {
      if (!['day', 'relax', 'party', 'night', 'work'].includes(body.preset)) throw fail('Choose a room preset.');
      return json(readResult(await db.rpc('room_apply_preset', { p_user: user.id, p_preset: body.preset })), 202);
    }
    if (path === 'command' && request.method === 'POST') {
      const current = await rpc('status');
      let command;
      try { command = validateRoomCommand(body, current.controller?.devices || []); }
      catch (e) { throw fail(e.message); }
      return json(await rpc('command', command), 202);
    }
    if (path === 'pair' && request.method === 'POST') {
      const credential = `ctrb_${randomBytes(32).toString('hex')}`;
      await rpc('pair', { key_hash: hash(credential) });
      return json({ credential }); // shown once, never persisted in browser storage
    }
    if (path === 'revoke' && request.method === 'POST') return json(await rpc('revoke'));
    if (path === 'bridge/poll' && request.method === 'POST') return json(await rpc('poll'));
    if (path === 'bridge/ack' && request.method === 'POST') {
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !Array.isArray(body.results) || body.results.length > 16) throw fail('Invalid command receipt.');
      for (const r of body.results) {
        if (!r || typeof r.id !== 'string' || typeof r.ok !== 'boolean' || (r.error !== undefined && (typeof r.error !== 'string' || r.error.length > 240))) throw fail('Invalid light receipt.');
      }
      return json(await rpc('ack', body));
    }
    return json({ error: 'Room endpoint not found.' }, 404);
  } catch (e) { return json({ error: e.message || 'Room request failed.' }, e.status || 500); }
}
