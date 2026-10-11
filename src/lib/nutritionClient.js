import { supabase, insert, update, remove } from './supabase.js';
import { nutritionEntry, nutritionNumber, NUTRIENTS } from './nutrition.js';
import { notifyDataChanged } from './useData.js';
import { authApi } from './api.js';

async function checkedWrite(table, result) {
  if (result.error) throw new Error(result.error.message || 'Could not save. Try again.');
  notifyDataChanged(table);
  return result.data?.[0];
}
export async function createNutritionKey(name) {
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = `ctp_${hex(bytes)}`;
  const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const row = await checkedWrite('api_keys', await insert('api_keys', [{ name: name.trim().slice(0, 100) || 'Nutrition GPT', key_prefix: raw.slice(0, 12), key_hash: hash }]));
  if (!row?.id) throw new Error('Key creation was not confirmed. Try again.');
  return raw;
}
export const revokeNutritionKey = async (id) => checkedWrite('api_keys', await remove('api_keys', id));
export async function saveNutritionMeal(draft, { id, timestamp } = {}) {
  const values = nutritionEntry({ ...draft, image_url: draft.photo_url || undefined, timestamp });
  const result = draft.id
    ? await update('nutrition_logs', draft.id, values)
    : await insert('nutrition_logs', [{ ...values, id }]);
  // Keep a draft's UUID through a failed network response, so retrying cannot
  // insert the same meal twice. Never overwrite on a duplicate UUID.
  if (result.error?.code === '23505' && !draft.id && id) {
    const found = await supabase.from('nutrition_logs').select('*').eq('id', id).maybeSingle();
    if (found.error || !found.data || Object.entries(values).some(([k, v]) => {
      if (NUTRIENTS.some((n) => n.key === k)) return Number(found.data[k]) !== v;
      if (k === 'logged_at') return new Date(found.data[k]).getTime() !== new Date(v).getTime();
      return (found.data[k] || null) !== (v || null);
    })) throw new Error('This meal may already have been saved. Refresh the log before changing it.');
    notifyDataChanged('nutrition_logs');
    return found.data;
  }
  const row = await checkedWrite('nutrition_logs', result);
  if (!row?.id) throw new Error('Meal save was not confirmed. Try again.');
  return row;
}
export const deleteNutritionMeal = async (id) => checkedWrite('nutrition_logs', await remove('nutrition_logs', id));
export async function saveNutritionGoals(id, draft) {
  const values = Object.fromEntries(NUTRIENTS.map(({ key }) => [key, nutritionNumber(draft[key], key)]));
  const row = await checkedWrite('user_goals', id ? await update('user_goals', id, { ...values, updated_at: new Date().toISOString() }) : await insert('user_goals', [values]));
  if (!row?.id) throw new Error('Goal save was not confirmed. Try again.');
  return row;
}
export async function saveNutritionWeight(weight, timestamp) {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0 || value > 2000) throw new Error('Enter a weight greater than zero and under 2,000 lb.');
  const row = await checkedWrite('weight_logs', await insert('weight_logs', [{ weight: value, logged_at: timestamp }]));
  if (!row?.id) throw new Error('Weight save was not confirmed. Try again.');
  return row;
}
export const deleteNutritionWeight = async (id) => checkedWrite('weight_logs', await remove('weight_logs', id));
export const analyzeMealPhoto = (photo, context) => authApi.post('/nutrition/analyze', { imageBase64: photo.base64, mediaType: 'image/jpeg', context });
export const analyzeMealDescription = (description) => authApi.post('/nutrition/analyze', { description });
export async function checkNutritionKey(raw) {
  const response = await fetch('/api/nutrition/check', { headers: { Authorization: `Bearer ${raw.trim()}` }, cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Connection check failed.');
  return result;
}
