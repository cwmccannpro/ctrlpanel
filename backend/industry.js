// ============================================================
// CTRLpanel — Industry Problems Agent (Agents folder)
//
// Runs on demand for one industry. Loads the user's agent_configs row, asks
// Claude (with web search, via backend/claude.js) to map the industry's value
// chain and to find narrow problems the person could build a solution for,
// then upserts the problems into `industry_problems` and records the run — with
// the map in its summary — in `industry_runs`.
//
// Progress streams as NDJSON through `write`, exactly like the Opportunities
// Agent (a web-search run takes minutes; Cloudflare drops idle responses after
// ~100s). Events:
//   { type:'start', run_id } · { type:'search', query } · { type:'results', count }
//   { type:'status', message } · { type:'ping' }
//   { type:'done', run_id, found, added, updated, searches, cost_usd }
//   { type:'error', message }
//
// Shared by Express (backend/routes/agents.js) and the Worker. Workers-compatible.
// ============================================================
import { researchIndustry } from './claude.js';
import { admin, collectSourceUrls, estimateCost, hostOf, isVerifiedHost } from './opportunities.js';
import {
  INDUSTRY_AGENT_KEY,
  EVIDENCE_KIND_IDS,
  SOLUTION_TYPE_IDS,
  SCORE_PARTS,
  normalizeIndustryConfig,
  isIndustryConfigReady,
  cleanIndustry,
  cleanFocus,
  industrySlug,
} from '../src/lib/industryConfig.js';
import { normalizeMap } from '../src/lib/industryMap.js';

const STALE_MS = 20 * 60 * 1000; // a "running" row older than this was abandoned
const KNOWN_LIMIT = 100;
const HEARTBEAT_MS = 15000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Without a source that appeared in the search results, a claimed pain earns no
// demand credit and only partial pain credit — so unsupported ideas can't rank high.
const UNSUPPORTED_PAIN_CAP = 15;

const text = (v, max = 600) => {
  const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || 0));

/* ---------------- Result shaping ---------------- */

function shapeEvidence(list, seenHosts) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const note = text(e?.note, 240);
    if (!note) continue;
    const url = /^https?:\/\//i.test(String(e?.url || '')) ? String(e.url).trim() : null;
    out.push({
      source: text(e?.source, 80),
      kind: EVIDENCE_KIND_IDS.includes(e?.kind) ? e.kind : 'other',
      url,
      note,
      verified: url ? isVerifiedHost(url, seenHosts) : false,
    });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Validate and shape the agent's submitted problems into `industry_problems`
 * rows: clamps every score part and sums them into `score`, checks each
 * evidence link's host against the search results (`seenHosts`), dedupes on
 * industry + title (keeping the higher score) and sorts best first. Never sets
 * `status` — that belongs to the user.
 */
export function prepareProblems(items, { industry, seenHosts = [], runId = null } = {}) {
  const industry_key = industrySlug(industry);
  const byKey = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const title = text(it?.title, 140);
    const problem = text(it?.problem);
    if (!title || !problem) continue;

    const evidence = shapeEvidence(it.evidence, seenHosts);
    const evidence_verified = evidence.filter((e) => e.verified).length;
    const scores = {};
    for (const { id, max } of SCORE_PARTS) scores[id] = clampInt(it?.scores?.[id], 0, max);
    if (!evidence_verified) {
      scores.demand = 0;
      scores.pain = Math.min(scores.pain, UNSUPPORTED_PAIN_CAP);
    }
    const score = SCORE_PARTS.reduce((sum, { id }) => sum + scores[id], 0);

    const row = {
      run_id: runId,
      dedupe_key: `${industry_key}::${industrySlug(title)}`,
      industry_key,
      industry,
      map_key: text(it?.key, 60),
      title,
      problem,
      who: text(it.who, 200),
      stage: text(it.stage, 100),
      solution: text(it.solution),
      mvp: text(it.mvp),
      solution_type: SOLUTION_TYPE_IDS.includes(it.solution_type) ? it.solution_type : null,
      build_weeks: it.build_weeks == null ? null : clampInt(it.build_weeks, 1, 52),
      pricing: text(it.pricing),
      reach: text(it.reach),
      competition: text(it.competition),
      evidence,
      evidence_verified,
      scores,
      score,
      risk: text(it.risk, 300),
    };
    const prev = byKey.get(row.dedupe_key);
    if (!prev || row.score > prev.score) byKey.set(row.dedupe_key, row);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

function normalizeSummary(s, map) {
  return {
    headline: text(s?.headline, 400) || '',
    where_to_start: text(s?.where_to_start, 800) || '',
    market_notes: text(s?.market_notes, 800) || '',
    map,
  };
}

/* ---------------- The run ---------------- */

/**
 * One on-demand run for `userId`. `deps` lets tests inject a fake Supabase
 * client, a fake research step and a fixed clock.
 */
export async function runIndustryCore({ userId, apiKey, today, industry: rawIndustry, focus: rawFocus } = {}, write = () => {}, deps = {}) {
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
  const industry = cleanIndustry(rawIndustry);
  const focus = cleanFocus(rawFocus);
  if (!industry) {
    emit({ type: 'error', message: 'Enter an industry to research.' });
    return;
  }

  const now = deps.now || new Date();
  const day = ISO_DATE.test(String(today || '')) ? today : now.toISOString().slice(0, 10);
  const research = deps.research || researchIndustry;
  const industry_key = industrySlug(industry);
  const beat = setInterval(() => emit({ type: 'ping' }), HEARTBEAT_MS);
  let db = null;
  let runId = null;

  try {
    db = deps.client || admin();
    const cutoff = new Date(now.getTime() - STALE_MS).toISOString();

    // A tab closed mid-run leaves a "running" row behind — retire those first.
    await db
      .from('industry_runs')
      .update({ status: 'error', error: 'Run was interrupted before it finished.', finished_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('status', 'running')
      .lt('run_at', cutoff);

    const { data: active } = await db
      .from('industry_runs')
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
      .eq('agent_key', INDUSTRY_AGENT_KEY)
      .maybeSingle();
    if (cfgErr) throw new Error(cfgErr.message);
    const config = normalizeIndustryConfig(cfgRow?.config);
    if (!isIndustryConfigReady(config)) throw new Error('Describe what you can build in Configure before running.');

    const { data: runRow, error: runErr } = await db
      .from('industry_runs')
      .insert({ user_id: userId, status: 'running', run_at: now.toISOString(), industry, industry_key, focus, config_snapshot: config })
      .select('id')
      .single();
    if (runErr) throw new Error(runErr.message);
    runId = runRow.id;
    emit({ type: 'start', run_id: runId, max_searches: config.max_searches });

    const { data: known } = await db
      .from('industry_problems')
      .select('title,status')
      .eq('user_id', userId)
      .eq('industry_key', industry_key)
      .order('last_seen_at', { ascending: false })
      .limit(KNOWN_LIMIT);

    const { result, usage, model, transcript } = await research(
      { config, industry, focus, known: known || [], today: day, apiKey },
      emit
    );

    const seenHosts = new Set([...collectSourceUrls(transcript)].map(hostOf).filter(Boolean));
    const rows = prepareProblems(result?.problems, { industry, seenHosts, runId });
    const map = normalizeMap(result?.map, rows.map((r) => r.map_key).filter(Boolean));
    emit({ type: 'status', message: `Saving ${rows.length} problems…` });

    let added = 0;
    if (rows.length) {
      const { data: existing } = await db
        .from('industry_problems')
        .select('dedupe_key')
        .eq('user_id', userId)
        .in('dedupe_key', rows.map((r) => r.dedupe_key));
      const have = new Set((existing || []).map((r) => r.dedupe_key));
      added = rows.filter((r) => !have.has(r.dedupe_key)).length;

      // No `status` / `first_seen_at` in the payload: new rows take the column
      // defaults, re-found rows keep the user's Saved / Exploring / Dismissed.
      const stamp = new Date().toISOString();
      const { error: upErr } = await db
        .from('industry_problems')
        .upsert(rows.map((r) => ({ ...r, user_id: userId, last_seen_at: stamp })), { onConflict: 'user_id,dedupe_key' });
      if (upErr) throw new Error(upErr.message);
    }

    const cost_usd = estimateCost(usage);
    const searches = usage?.web_search_requests || 0;
    await db
      .from('industry_runs')
      .update({
        status: 'complete',
        finished_at: new Date().toISOString(),
        summary: normalizeSummary(result?.summary, map),
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
    const message = e?.message || 'Industry run failed';
    if (db && runId) {
      await db
        .from('industry_runs')
        .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId)
        .then(() => {}, () => {});
    }
    emit({ type: 'error', message });
  } finally {
    clearInterval(beat);
  }
}
