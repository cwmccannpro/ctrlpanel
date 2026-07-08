// ============================================================
// CTRLpanel — Supabase client + auth + data access
// ALL database/auth calls go through this module (AGENTS.md rule #5).
// Tables are scoped per-user by RLS; user_id defaults to auth.uid() in the DB,
// so inserts don't need to pass it explicitly.
// ============================================================
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured ? createClient(url, anonKey) : null;

/* ---------------- Auth ---------------- */

export async function signUp({ email, password, fullName }) {
  if (!supabase) return { data: null, error: { message: 'Supabase is not configured.' } };
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
}

export async function signIn({ email, password }) {
  if (!supabase) return { data: null, error: { message: 'Supabase is not configured.' } };
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  if (!supabase) return;
  return supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!supabase) return { unsubscribe: () => {} };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return data.subscription;
}

/* ---------------- Profile + settings ---------------- */

export async function getProfile(userId) {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export async function getUserSettings(userId) {
  if (!supabase) return null;
  const { data } = await supabase.from('user_settings').select('*').eq('user_id', userId).single();
  return data;
}

export async function saveProfile(userId, patch) {
  if (!supabase) return { error: { message: 'Supabase is not configured.' } };
  return supabase.from('profiles').update(patch).eq('id', userId).select();
}

export async function saveUserSettings(userId, patch) {
  if (!supabase) return { error: { message: 'Supabase is not configured.' } };
  return supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() })
    .select();
}

/* ---------------- Generic CRUD (RLS-scoped) ---------------- */

export async function insert(table, rows) {
  if (!supabase) return { data: null, error: { message: 'supabase-not-configured' } };
  return supabase.from(table).insert(rows).select();
}

export async function update(table, id, patch) {
  if (!supabase) return { data: null, error: { message: 'supabase-not-configured' } };
  return supabase.from(table).update(patch).eq('id', id).select();
}

export async function remove(table, id) {
  if (!supabase) return { data: null, error: { message: 'supabase-not-configured' } };
  return supabase.from(table).delete().eq('id', id);
}

/**
 * Flexible read used by the Master Controller's query tool. RLS still scopes
 * every result to the current user. `search` runs a case-insensitive OR across
 * `searchColumns`; `filters` are exact-match equals.
 */
export async function queryTable(
  table,
  { search, searchColumns = [], filters = {}, order, ascending = false, limit = 50 } = {}
) {
  if (!supabase) return { data: [], error: { message: 'supabase-not-configured' } };
  let q = supabase.from(table).select('*');
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') q = q.eq(k, v);
  }
  if (search && searchColumns.length) {
    q = q.or(searchColumns.map((c) => `${c}.ilike.%${search}%`).join(','));
  }
  if (order) q = q.order(order, { ascending });
  return q.limit(limit);
}
