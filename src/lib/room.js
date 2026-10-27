import { authApi } from './api.js';

export const room = {
  status: () => authApi.get('/room/status'),
  connect: () => authApi.post('/room/connection'),
  disconnect: () => authApi.del('/room/connection'),
  async command(method, path, body = {}) {
    const { id } = await authApi.post('/room/commands', { id: crypto.randomUUID(), method, path, body });
    const start = Date.now();
    while (Date.now() - start < 185000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await authApi.get(`/room/commands/${id}`);
      if (result.status === 'done') return result.result;
      if (['failed', 'expired', 'unknown'].includes(result.status)) {
        throw new Error(result.error || (result.status === 'expired'
          ? 'The controller did not pick up this action. Nothing was sent.'
          : 'Completion was not confirmed. Check Activity before retrying.'));
      }
    }
    throw new Error('Completion was not confirmed. Check Activity before retrying.');
  },
};

export const DEFAULT_LIGHT = { power: true, brightness: 100, mode: 'white', kelvin: 6500, color: '#ffffff' };
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function colorHue(hex) {
  const channels = hex.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255);
  const [r, g, b] = channels, max = Math.max(...channels), min = Math.min(...channels), d = max - min;
  if (!d) return 0;
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
export function hueColor(degrees) {
  const h = Number(degrees) / 60, x = 1 - Math.abs(h % 2 - 1);
  const channels = h < 1 ? [1,x,0] : h < 2 ? [x,1,0] : h < 3 ? [0,1,x] : h < 4 ? [0,x,1] : h < 5 ? [x,0,1] : [1,0,x];
  return '#' + channels.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
export function routineLabel(schedule) {
  if (schedule.date) return schedule.date;
  if (schedule.days?.length === 7) return 'Every day';
  return (schedule.days || []).map((d) => DAYS[d]).join(', ');
}
