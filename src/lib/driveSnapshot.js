import { dayKey } from './helpers.js';

export const DRIVE_ROW_LIMIT = 500;
// Fetch one extra row so a bounded glance never silently claims complete totals.
export async function loadDriveSnapshot(client, signal, now = new Date()) {
  const results = await Promise.all([
    client.from('tasks').select('id,title,column_name,board_id,due_date').order('due_date', { ascending: true, nullsFirst: false }),
    client.from('boards').select('id,columns'),
    client.from('habits').select('id,name,active').eq('active', true),
    client.from('habit_logs').select('habit_id,log_date,completed').eq('log_date', dayKey(now)),
  ].map(query => query.limit(DRIVE_ROW_LIMIT + 1).abortSignal(signal)));
  if (signal.aborted) throw new Error('Sync cancelled.');
  for (const result of results) {
    if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Incomplete sync response.');
  }
  return {
    data: Object.fromEntries(['tasks', 'boards', 'habits', 'logs'].map((key, i) => [key, results[i].data.slice(0, DRIVE_ROW_LIMIT)])),
    partial: results.some(result => result.data.length > DRIVE_ROW_LIMIT),
  };
}
