// Shared, import-free contract. Commands are absolute settings, never toggles.
export const ROOM_COMMAND_TTL = 90000;
export const ROOM_ONLINE_MS = 30000;
export function roomOnline(controller, now = Date.now()) {
  return Boolean(controller?.paired && controller?.last_seen && now - Date.parse(controller.last_seen) < ROOM_ONLINE_MS);
}
export function validateRoomCommand(body, devices) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A room command is required.');
  if (Object.keys(body).some(k => !['target', 'patch'].includes(k))) throw new Error('Unknown command field.');
  const { target, patch } = body;
  if (target !== 'all' && !devices.some(d => d.id === target)) throw new Error('Choose a configured light.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length !== 1) throw new Error('Change one setting at a time.');
  const [key] = Object.keys(patch), value = patch[key];
  if (!['power', 'brightness', 'color', 'temperature'].includes(key)) throw new Error('Unsupported light setting.');
  if (key === 'power' && typeof value !== 'boolean') throw new Error('Power must be on or off.');
  if (key === 'brightness' && (!Number.isInteger(value) || value < 1 || value > 100)) throw new Error('Brightness must be 1–100%.');
  if (key === 'color' && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new Error('Choose a valid color.');
  if (key === 'temperature' && (!Number.isInteger(value) || value < 2700 || value > 6500)) throw new Error('White temperature must be 2700–6500 K.');
  const targets = devices.filter(d => (target === 'all' || d.id === target) && (key !== 'temperature' || d.cct));
  if (!targets.length) throw new Error('This light does not support white temperature.');
  return { targets: targets.map(d => d.id), patch: { [key]: key === 'color' ? value.toLowerCase() : value } };
}
