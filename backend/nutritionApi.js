// Shared nutrition API for Express + Worker. External writes derive ownership
// exclusively from a hashed nutrition key. Photo analysis uses a verified session.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { analyzeNutritionMeal } from './claude.js';
import { AI_ESTIMATE_USD, withAiLease } from './aiGuard.js';
import { nutritionEntry, nutritionTimeZone, nutritionDayRange, nutritionTotals, nutritionGoals, nutritionMicros, micronutrientTotals, micronutrientGoals } from '../src/lib/nutrition.js';
import { nutritionOpenApi } from '../src/lib/nutritionIntegration.js';

export const MAX_NUTRITION_BODY = 950000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const credentials = () => ({
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
function admin() {
  const { url, service } = credentials();
  if (!url || !service) throw fail('Nutrition uploads need the Supabase service role configured on the server.', 503);
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}
function dbError(error) {
  if (error) throw fail('Could not reach the nutrition database. Check the nutrition tables and try again.', 503);
}
export const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex');
export function apiKeyFromHeaders(get) {
  const auth = get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  return bearer ? bearer[1].trim() : get('x-api-key') || '';
}
export async function userIdForApiKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!/^ctp_[a-f0-9]{48}$/.test(key)) return null;
  const client = admin();
  const { data, error } = await client.from('api_keys').select('id,user_id').eq('key_hash', hashKey(key)).maybeSingle();
  dbError(error);
  if (!data) return null;
  // Await so a Worker does not abandon the usage stamp after returning.
  await client.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
  return data.user_id;
}
async function sessionClient(headers) {
  const token = apiKeyFromHeaders((name) => headers.get(name));
  const { url, anon } = credentials();
  if (!url || !anon) throw fail('Supabase authentication is not configured on the server.', 503);
  if (!token || token.startsWith('ctp_')) throw fail('Sign in to CTRLpanel to use this feature.', 401);
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw fail('Your session expired. Sign in again.', 401);
  return { client, user: data.user };
}
async function settingsFor(client, userId) {
  const { data, error } = await client.from('user_settings').select('connectors,ui_preferences').eq('user_id', userId).maybeSingle();
  dbError(error);
  const apiKey = (data?.connectors || []).find((c) => c.type === 'anthropic' && c.enabled)?.config?.key?.trim() || '';
  return { apiKey, timezone: nutritionTimeZone(data?.ui_preferences?.nutrition?.timeZone || 'UTC') };
}
async function daySummary(client, userId, loggedAt, timezone) {
  const { day, start, end } = nutritionDayRange(loggedAt, timezone);
  const [logs, goals] = await Promise.all([
    client.from('nutrition_logs').select('calories,protein,carbs,fat,micros').eq('user_id', userId).gte('logged_at', start).lt('logged_at', end),
    client.from('user_goals').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
  ]);
  // A successful insert is still successful when a subsequent totals read fails.
  // Do not make a client retry an already-persisted meal because totals failed.
  return { day, timezone,
    day_totals: logs.error ? null : { ...nutritionTotals(logs.data), micros: Object.fromEntries(Object.entries(micronutrientTotals(logs.data)).map(([key, value]) => [key, value.amount])) },
    goals: goals.error ? null : { ...nutritionGoals(goals.data?.[0]), micros: micronutrientGoals(goals.data?.[0]) },
  };
}
function mealId(userId, requestId) {
  const hex = hashKey(`nutrition:${userId}:${requestId}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
export async function logNutritionEntry(userId, payload = {}) {
  const values = nutritionEntry(payload);
  if (payload.request_id != null && (typeof payload.request_id !== 'string' || payload.request_id.trim().length < 8 || payload.request_id.length > 120)) {
    throw fail('request_id must be a unique meal identifier of 8–120 characters.');
  }
  const client = admin();
  const { timezone } = await settingsFor(client, userId);
  const id = payload.request_id ? mealId(userId, payload.request_id.trim()) : undefined;
  const row = { ...values, user_id: userId, logged_at: values.logged_at || new Date().toISOString(), ...(id ? { id } : {}) };
  let { data: entry, error } = await client.from('nutrition_logs').insert(row).select().single();
  let replayed = false;
  if (error?.code === '23505' && id) {
    const found = await client.from('nutrition_logs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    dbError(found.error);
    entry = found.data;
    if (!entry || Object.keys(values).some((k) => {
      if (['calories', 'protein', 'carbs', 'fat'].includes(k)) return Number(entry[k]) !== values[k];
      if (k === 'micros') return JSON.stringify(nutritionMicros(entry.micros || {})) !== JSON.stringify(values[k]);
      if (k === 'logged_at') return new Date(entry[k]).getTime() !== new Date(values[k]).getTime();
      return (entry[k] || null) !== (values[k] || null);
    })) throw fail('This request_id already belongs to a different meal. Use a new id for a new meal.', 409);
    replayed = true;
  } else dbError(error);
  if (!entry?.id) throw fail('The meal save was not confirmed. Retry with the same request_id.', 503);
  return {
    ok: true, replayed,
    entry: Object.fromEntries(['id', 'meal_name', 'calories', 'protein', 'carbs', 'fat', 'micros', 'logged_at'].map((k) => [k, entry[k]])),
    ...(await daySummary(client, userId, entry.logged_at, timezone)),
  };
}

// One dispatcher keeps authentication, validation and responses identical.
export async function handleNutritionRequest(method, url, headers, body) {
  if (method === 'POST' && new TextEncoder().encode(JSON.stringify(body || {})).length > MAX_NUTRITION_BODY) {
    throw fail('Photo is too large. Choose a smaller image.', 413);
  }
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api/nutrition/openapi.json' && method === 'GET') return nutritionOpenApi(process.env.FRONTEND_URL || url.origin);
  if ((path === '/api/nutrition/log' && method === 'POST') || (path === '/api/nutrition/check' && method === 'GET')) {
    const userId = await userIdForApiKey(apiKeyFromHeaders((name) => headers.get(name)));
    if (!userId) throw fail('Invalid or revoked nutrition API key.', 401);
    if (method === 'POST') return logNutritionEntry(userId, body);
    const client = admin();
    const { timezone } = await settingsFor(client, userId);
    const summary = await daySummary(client, userId, new Date(), timezone);
    if (!summary.day_totals || !summary.goals) throw fail('The nutrition database is unavailable. Try again.', 503);
    return { ok: true, ...summary };
  }
  if ((path === '/api/nutrition/status' && method === 'GET') || (path === '/api/nutrition/analyze' && method === 'POST')) {
    const { client, user } = await sessionClient(headers);
    const settings = await settingsFor(client, user.id);
    if (method === 'GET') {
      const [keys, logs] = await Promise.all([
        client.from('api_keys').select('id').limit(1), client.from('nutrition_logs').select('id,notes').limit(1),
      ]);
      return {
        ready: Boolean(credentials().service) && !keys.error && !logs.error,
        photoReady: Boolean(settings.apiKey || process.env.ANTHROPIC_API_KEY) && !logs.error,
        timezone: settings.timezone,
        message: keys.error || logs.error ? 'Apply the nutrition tables in supabase-schema.sql before logging.' :
          !credentials().service ? 'The server needs SUPABASE_SERVICE_ROLE_KEY for custom GPT uploads.' : '',
      };
    }
    if (!settings.apiKey && !process.env.ANTHROPIC_API_KEY) throw fail('Add an Anthropic key in Settings → Connectors to estimate meals from a photo or description.', 503);
    // Photo/description estimates on the server's key count against the per-user limits.
    return withAiLease({ user, apiKey: settings.apiKey, estimateUsd: AI_ESTIMATE_USD.nutrition }, async (track) => {
      const result = await analyzeNutritionMeal({ ...body, apiKey: settings.apiKey });
      track(result.usage);
      return result;
    });
  }
  throw fail('Nutrition endpoint not found.', 404);
}
