// ============================================================
// CTRLpanel — external nutrition logging (custom-GPT endpoint)
//
// POST /api/nutrition/log authenticated by a per-user API key generated
// in Settings. Only the SHA-256 hash of a key is stored (api_keys table);
// revoking = deleting the row. Entries land in nutrition_logs exactly like
// manual ones, so they count toward daily totals/goals automatically.
// Workers-compatible: node:crypto + fetch-based Supabase SDK only.
// ============================================================
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  if (!_admin) throw new Error('Supabase service role is not configured on the server.');
  return _admin;
}

export const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex');

/** Resolve an API key (Authorization: Bearer ctp_… or X-API-Key) to a user id. */
export async function userIdForApiKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key.startsWith('ctp_')) return null;
  const { data } = await admin().from('api_keys').select('id, user_id').eq('key_hash', hashKey(key)).maybeSingle();
  if (!data) return null;
  // Best-effort usage stamp; never block the request on it.
  admin().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
  return data.user_id;
}

// Header extraction shared by Express (req.headers object) and Worker (Headers).
export function apiKeyFromHeaders(get) {
  const auth = get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return get('x-api-key') || '';
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Insert one nutrition log entry for the resolved user.
 * Payload: { food_name (or meal_name/name), calories, protein, carbs, fat,
 *            notes?, timestamp?, image_url? }
 * Returns the entry plus that day's running totals and the user's goals so
 * the external client (custom GPT) can report progress back.
 */
export async function logNutritionEntry(userId, payload = {}) {
  const name = String(payload.food_name || payload.meal_name || payload.name || '').trim();
  if (!name) throw new Error('food_name is required.');

  let loggedAt = new Date();
  if (payload.timestamp) {
    const t = new Date(payload.timestamp);
    if (Number.isNaN(t.getTime())) throw new Error('timestamp is not a valid date.');
    loggedAt = t;
  }

  const row = {
    user_id: userId,
    meal_name: name,
    calories: num(payload.calories),
    protein: num(payload.protein),
    carbs: num(payload.carbs),
    fat: num(payload.fat),
    notes: payload.notes ? String(payload.notes) : null,
    photo_url: payload.image_url ? String(payload.image_url) : null,
    logged_at: loggedAt.toISOString(),
  };
  const { data: entry, error } = await admin().from('nutrition_logs').insert(row).select().single();
  if (error) throw new Error(error.message);

  // Day totals + goals for the GPT's confirmation message.
  const day = row.logged_at.slice(0, 10);
  const [{ data: dayRows }, { data: goalRows }] = await Promise.all([
    admin().from('nutrition_logs').select('calories, protein, carbs, fat')
      .eq('user_id', userId).gte('logged_at', `${day}T00:00:00Z`).lte('logged_at', `${day}T23:59:59.999Z`),
    admin().from('user_goals').select('calories, protein, carbs, fat').eq('user_id', userId).limit(1),
  ]);
  const totals = (dayRows || []).reduce(
    (t, m) => ({
      calories: t.calories + num(m.calories),
      protein: t.protein + num(m.protein),
      carbs: t.carbs + num(m.carbs),
      fat: t.fat + num(m.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    ok: true,
    entry: { id: entry.id, meal_name: entry.meal_name, calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat, logged_at: entry.logged_at },
    day,
    day_totals: totals,
    goals: goalRows?.[0] || { calories: 2400, protein: 180, carbs: 250, fat: 80 },
  };
}
