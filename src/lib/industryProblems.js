// ============================================================
// CTRLpanel — Industry Problems page helpers (pure; no React, no Supabase)
// Grouping runs by industry, status filters, and turning a problem into
// Markdown or into a new project.
// ============================================================
import { SOLUTION_LABEL, SCORE_PARTS, EVIDENCE_LABEL } from './industryConfig.js';

export const STATUS_FILTERS = [
  { id: 'active', label: 'Active', test: (s) => s === 'new' || s === 'saved' || s === 'exploring' },
  { id: 'saved', label: 'Saved', test: (s) => s === 'saved' },
  { id: 'exploring', label: 'Exploring', test: (s) => s === 'exploring' },
  { id: 'dismissed', label: 'Dismissed', test: (s) => s === 'dismissed' },
];

export const scoreTone = (score) => (score >= 75 ? 'top' : score >= 60 ? 'good' : 'ok');

/**
 * Industries the user has researched, newest first, from completed runs.
 * Each entry: { key, name, run } where `run` is the latest completed run for it.
 */
export function industriesFromRuns(runs) {
  const latest = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    if (r?.status !== 'complete' || !r.industry_key) continue;
    const prev = latest.get(r.industry_key);
    if (!prev || String(r.run_at) > String(prev.run_at)) latest.set(r.industry_key, r);
  }
  return [...latest.values()]
    .sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)))
    .map((run) => ({ key: run.industry_key, name: run.industry, run }));
}

/** The problems from a run's industry, best first (ties: most recently seen). */
export function problemsFor(problems, industryKey) {
  return (Array.isArray(problems) ? problems : [])
    .filter((p) => p.industry_key === industryKey)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')));
}

/** problem_key -> problem row, for the problems the given run produced (re-found rows move to the newest run). */
export function problemsByMapKey(problems, runId) {
  const out = new Map();
  for (const p of problems) if (p.run_id === runId && p.map_key) out.set(p.map_key, p);
  return out;
}

const line = (label, value) => (value ? `**${label}:** ${value}\n\n` : '');

/** A self-contained brief for pasting into notes, a doc or a chat. */
export function problemToMarkdown(p) {
  const parts = SCORE_PARTS.filter((s) => p.scores && s.id in p.scores).map((s) => `${s.label} ${p.scores[s.id]}/${s.max}`);
  let md = `## ${p.title}\n\n`;
  md += `*${[p.industry, p.stage, `score ${p.score}/100`].filter(Boolean).join(' · ')}*\n\n`;
  md += line('The problem', p.problem);
  md += line('Who has it', p.who);
  md += line('What to build', p.solution);
  md += line('First version', p.mvp);
  md += line('Type', [SOLUTION_LABEL[p.solution_type], p.build_weeks ? `~${p.build_weeks} wk to ship` : ''].filter(Boolean).join(' · '));
  md += line('Pricing', p.pricing);
  md += line('Reaching buyers', p.reach);
  md += line('Competition', p.competition);
  md += line('Main risk', p.risk);
  if (parts.length) md += `**Score:** ${parts.join(' · ')}\n\n`;
  const ev = Array.isArray(p.evidence) ? p.evidence : [];
  if (ev.length) {
    md += '**Evidence**\n\n';
    for (const e of ev) {
      const who = [e.source, EVIDENCE_LABEL[e.kind]].filter(Boolean).join(' — ');
      md += `- ${e.url ? `[${who || e.url}](${e.url})` : who}: ${e.note}${e.url && !e.verified ? ' _(unverified link)_' : ''}\n`;
    }
    md += '\n';
  }
  return md.trimEnd() + '\n';
}

/** Row for the `projects` table when the user starts a project from a problem. */
export function projectFromProblem(p) {
  return {
    name: String(p.title || 'New idea').slice(0, 120),
    status: 'Active',
    description: [p.problem, p.who ? `Buyer: ${p.who}` : ''].filter(Boolean).join('\n\n'),
    goal: p.mvp ? `Ship a first version: ${p.mvp}` : p.solution || '',
    notes: '',
    files: [],
  };
}
