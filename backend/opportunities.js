// ============================================================
// CTRLpanel — Opportunities Agent (Agents folder)
//
// Runs on demand. Loads the user's agent_configs row, asks Claude (with web
// search, via backend/claude.js) to find and rank jobs, programs, events,
// certifications and competitions, then upserts them into `opportunities`
// and records the run in `opportunity_runs`.
//
// Progress streams as NDJSON through `write`, so a multi-minute run keeps the
// HTTP response alive (Cloudflare drops responses idle for ~100s). Events:
//   { type:'start', run_id } · { type:'search', query } · { type:'results', count }
//   { type:'status', message } · { type:'ping' }
//   { type:'done', run_id, found, added, updated, searches, cost_usd }
//   { type:'error', message }
//
// Shared by Express (backend/routes/agents.js) and the Worker. The service
// role writes rows with an explicit user_id taken from the verified session.
// Workers-compatible: fetch-based Supabase SDK + the Anthropic SDK only.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { researchOpportunities } from './claude.js';
import {
  OPPORTUNITIES_AGENT_KEY,
  OPPORTUNITY_KIND_IDS,
  normalizeConfig,
  isConfigReady,
} from '../src/lib/opportunityConfig.js';

const STALE_MS = 20 * 60 * 1000; // a "running" row older than this was abandoned
const KNOWN_LIMIT = 150;
const HEARTBEAT_MS = 15000;
const MODES = ['remote', 'in_person', 'hybrid'];

// Claude Opus 5 list prices per token, plus web search at $10 / 1,000.
const RATES = { input: 5 / 1e6, output: 25 / 1e6, cacheWrite: 6.25 / 1e6, cacheRead: 0.5 / 1e6, search: 10 / 1000 };

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) _admin = createClient(url, key, { auth: { persistSession: false } });
  if (!_admin) throw new Error('Supabase service role is not configured on the server.');
  return _admin;
}

/* ---------------- URL helpers ---------------- */

const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$)/i;

/** Stable dedupe key for a URL: host (no www) + path (no trailing slash) + non-tracking query. */
export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return '';
  }
}

export function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A submitted URL is "verified" when its host (or a parent/sub-domain of it) appeared in the search results. */
export function isVerifiedHost(url, seenHosts) {
  const h = hostOf(url);
  if (!h) return false;
  for (const s of seenHosts) if (s === h || h.endsWith(`.${s}`) || s.endsWith(`.${h}`)) return true;
  return false;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Every source URL present in the research transcript: `url` fields on search
 * results and citations, plus URLs inside tool-result text (e.g. dynamic
 * filtering output). The agent's own submit_opportunities input is skipped —
 * it is what we're checking, not evidence.
 */
export function collectSourceUrls(content, out = new Set()) {
  const walk = (node, inResult) => {
    if (typeof node === 'string') {
      if (inResult) for (const m of node.match(URL_IN_TEXT) || []) out.add(m.replace(/[.,;:!?]+$/, ''));
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, inResult);
      return;
    }
    if (node.type === 'tool_use') return;
    const result = inResult || (typeof node.type === 'string' && node.type.endsWith('tool_result'));
    if (typeof node.url === 'string') out.add(node.url);
    for (const [k, v] of Object.entries(node)) if (k !== 'url') walk(v, result);
  };
  walk(content, false);
  return out;
}

/* ---------------- Result shaping ---------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (v) => (typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const text = (v) => (v == null ? null : String(v).trim() || null);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Validate and shape the agent's submitted items into `opportunities` rows:
 * drops unknown kinds, past deadlines and past events; clamps scores; flags
 * links whose host never appeared in the search results; dedupes (keeping the
 * higher score). Sorted best first. Never sets `status` — that is the user's.
 */
export function prepareOpportunities(items, { today, seenHosts = [], runId = null } = {}) {
  const seen = [...seenHosts];
  const byKey = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const title = text(it?.title);
    if (!title || !OPPORTUNITY_KIND_IDS.includes(it.kind)) continue;
    const deadline = asDate(it.deadline);
    const starts_on = asDate(it.starts_on);
    if (deadline && today && deadline < today) continue;
    if (!deadline && it.kind === 'event' && starts_on && today && starts_on < today) continue;

    const url = /^https?:\/\//i.test(String(it.url || '')) ? String(it.url).trim() : null;
    const dedupe_key = (url && normalizeUrl(url)) || `${slug(it.org)}::${slug(title)}`;
    const row = {
      run_id: runId,
      dedupe_key,
      kind: it.kind,
      title,
      org: text(it.org),
      industry: text(it.industry),
      location: text(it.location),
      mode: MODES.includes(it.mode) ? it.mode : null,
      starts_on,
      deadline,
      cost: text(it.cost),
      is_free: Boolean(it.is_free),
      url,
      score: Math.min(100, Math.max(0, Math.round(Number(it.score) || 0))),
      reasons: Array.isArray(it.reasons) ? it.reasons.map((r) => String(r).trim()).filter(Boolean).slice(0, 5) : [],
      source_verified: url ? isVerifiedHost(url, seen) : false,
    };
    const prev = byKey.get(dedupe_key);
    if (!prev || row.score > prev.score) byKey.set(dedupe_key, row);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

function normalizeSummary(s) {
  const gaps = Array.isArray(s?.skill_gaps) ? s.skill_gaps : [];
  return {
    headline: text(s?.headline) || '',
    skill_gaps: gaps
      .filter((g) => text(g?.skill))
      .slice(0, 8)
      .map((g) => ({
        skill: text(g.skill),
        why: text(g.why) || '',
        how_to_learn: text(g.how_to_learn) || '',
        url: /^https?:\/\//i.test(String(g.url || '')) ? String(g.url).trim() : null,
      })),
    market_notes: text(s?.market_notes) || '',
  };
}

/** Approximate USD cost of a run at Claude Opus 5 list prices. */
export function estimateCost(u = {}) {
  const cost =
    (u.input_tokens || 0) * RATES.input +
    (u.output_tokens || 0) * RATES.output +
    (u.cache_creation_input_tokens || 0) * RATES.cacheWrite +
    (u.cache_read_input_tokens || 0) * RATES.cacheRead +
    (u.web_search_requests || 0) * RATES.search;
  return Math.round(cost * 10000) / 10000;
}

/* ---------------- The run ---------------- */

/**
 * One on-demand run for `userId`. `deps` lets tests inject a fake Supabase
 * client, a fake research step and a fixed clock.
 */
export async function runOpportunitiesCore({ userId, apiKey, today } = {}, write = () => {}, deps = {}) {
  const emit = (obj) => {
    try {
      const r = write(obj);
      if (r && typeof r.catch === 'function') r.catch(() => {}); // client went away
    } catch {
      /* client went away */
    }
  };
  if (!userId) {
    emit({ type: 'error', message: 'Not authenticated' });
    return;
  }

  const now = deps.now || new Date();
  const day = ISO_DATE.test(String(today || '')) ? today : now.toISOString().slice(0, 10);
  const research = deps.research || researchOpportunities;
  const beat = setInterval(() => emit({ type: 'ping' }), HEARTBEAT_MS);
  let db = null;
  let runId = null;

  try {
    db = deps.client || admin();
    const cutoff = new Date(now.getTime() - STALE_MS).toISOString();

    // A tab closed mid-run leaves a "running" row behind — retire those first.
    await db
      .from('opportunity_runs')
      .update({ status: 'error', error: 'Run was interrupted before it finished.', finished_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('status', 'running')
      .lt('run_at', cutoff);

    const { data: active } = await db
      .from('opportunity_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'running')
      .gte('run_at', cutoff)
      .limit(1);
    if (active?.length) throw new Error('A run is already in progress — wait for it to finish.');

    const { data: cfgRow, error: cfgErr } = await db
      .from('agent_configs')
      .select('config')
      .eq('user_id', userId)
      .eq('agent_key', OPPORTUNITIES_AGENT_KEY)
      .maybeSingle();
    if (cfgErr) throw new Error(cfgErr.message);
    const config = normalizeConfig(cfgRow?.config);
    if (!isConfigReady(config)) throw new Error('Add your profile or current focus in Configure before running.');

    const { data: runRow, error: runErr } = await db
      .from('opportunity_runs')
      .insert({ user_id: userId, status: 'running', run_at: now.toISOString(), config_snapshot: config })
      .select('id')
      .single();
    if (runErr) throw new Error(runErr.message);
    runId = runRow.id;
    emit({ type: 'start', run_id: runId, max_searches: config.max_searches });

    const { data: known } = await db
      .from('opportunities')
      .select('title,org,status')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(KNOWN_LIMIT);

    const { result, usage, model, transcript } = await research(
      { config, known: known || [], today: day, apiKey },
      emit
    );

    const seenHosts = new Set([...collectSourceUrls(transcript)].map(hostOf).filter(Boolean));
    const rows = prepareOpportunities(result?.opportunities, { today: day, seenHosts, runId });
    emit({ type: 'status', message: `Saving ${rows.length} results…` });

    let added = 0;
    if (rows.length) {
      const { data: existing } = await db
        .from('opportunities')
        .select('dedupe_key')
        .eq('user_id', userId)
        .in('dedupe_key', rows.map((r) => r.dedupe_key));
      const have = new Set((existing || []).map((r) => r.dedupe_key));
      added = rows.filter((r) => !have.has(r.dedupe_key)).length;

      // No `status` / `first_seen_at` in the payload: new rows take the column
      // defaults, re-found rows keep the user's Saved / Applied / Dismissed.
      const stamp = new Date().toISOString();
      const { error: upErr } = await db
        .from('opportunities')
        .upsert(rows.map((r) => ({ ...r, user_id: userId, last_seen_at: stamp })), { onConflict: 'user_id,dedupe_key' });
      if (upErr) throw new Error(upErr.message);
    }

    const cost_usd = estimateCost(usage);
    const searches = usage?.web_search_requests || 0;
    await db
      .from('opportunity_runs')
      .update({
        status: 'complete',
        finished_at: new Date().toISOString(),
        summary: normalizeSummary(result?.summary),
        found: rows.length,
        added,
        searches,
        input_tokens:
          (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0),
        output_tokens: usage?.output_tokens || 0,
        cost_usd,
        model: model || null,
      })
      .eq('id', runId);

    emit({ type: 'done', run_id: runId, found: rows.length, added, updated: rows.length - added, searches, cost_usd });
  } catch (e) {
    const message = e?.message || 'Opportunities run failed';
    if (db && runId) {
      await db
        .from('opportunity_runs')
        .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId)
        .then(() => {}, () => {});
    }
    emit({ type: 'error', message });
  } finally {
    clearInterval(beat);
  }
}
