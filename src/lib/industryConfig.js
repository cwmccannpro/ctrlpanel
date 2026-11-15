// ============================================================
// CTRLpanel — Industry Problems Agent config (shared)
// Plain JS with no browser or Node APIs, so the page, the config modal and
// the backend (backend/industry.js, backend/claude.js) all import it.
// Stored per user in agent_configs.config (agent_key = 'industry_problems').
// ============================================================

export const INDUSTRY_AGENT_KEY = 'industry_problems';

// What kind of thing the person is able to build — steers which problems are "attainable".
export const SOLUTION_TYPES = [
  { id: 'web_app', label: 'Web app / SaaS', short: 'Web app' },
  { id: 'automation', label: 'Automation & integrations', short: 'Automation' },
  { id: 'ai_tool', label: 'AI document / data tool', short: 'AI tool' },
  { id: 'dashboard', label: 'Dashboards & reporting', short: 'Dashboard' },
  { id: 'mobile', label: 'Mobile app', short: 'Mobile app' },
  { id: 'extension', label: 'Browser extension / plugin', short: 'Plugin' },
  { id: 'service', label: 'Productized service', short: 'Service' },
];
export const SOLUTION_TYPE_IDS = SOLUTION_TYPES.map((t) => t.id);
export const SOLUTION_LABEL = Object.fromEntries(SOLUTION_TYPES.map((t) => [t.id, t.short]));

export const BUYERS = [
  { id: 'solo', label: 'Solo operators & freelancers' },
  { id: 'smb', label: 'Small businesses (2–50 staff)' },
  { id: 'mid', label: 'Mid-size companies (50–500 staff)' },
];
export const BUYER_IDS = BUYERS.map((b) => b.id);

export const BUILD_WEEKS = [
  { value: 2, label: '≤ 2 weeks' },
  { value: 4, label: '≤ 1 month' },
  { value: 8, label: '≤ 2 months' },
  { value: 12, label: '≤ 3 months' },
];

// Web searches per run. Estimates cover Claude Opus 5 tokens + $10 / 1,000 searches.
export const SEARCH_DEPTHS = [
  { value: 10, label: 'Quick', estimate: '≈ $0.50' },
  { value: 20, label: 'Standard', estimate: '≈ $1' },
  { value: 30, label: 'Deep', estimate: '≈ $1.50' },
];
export const RESULT_TARGETS = [6, 10, 15, 20];

// Where a piece of evidence came from. Reviews + job posts + forums are the
// strongest signals that a pain is real and that someone pays to fix it.
export const EVIDENCE_KINDS = [
  { id: 'review', label: 'Software review' },
  { id: 'forum', label: 'Forum / community' },
  { id: 'job_post', label: 'Job post' },
  { id: 'article', label: 'Article / report' },
  { id: 'directory', label: 'Directory / listing' },
  { id: 'other', label: 'Other' },
];
export const EVIDENCE_KIND_IDS = EVIDENCE_KINDS.map((k) => k.id);
export const EVIDENCE_LABEL = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k.id, k.label]));

// The score is the sum of these five parts (each clamped to its max).
export const SCORE_PARTS = [
  { id: 'pain', label: 'Pain', max: 30, hint: 'How often and how badly it hurts' },
  { id: 'attainable', label: 'Attainable', max: 25, hint: 'Fits your skills and time, no heavy regulation or cold-start' },
  { id: 'demand', label: 'Demand', max: 20, hint: 'Evidence people already pay to fix it' },
  { id: 'reach', label: 'Reach', max: 15, hint: 'Buyers you can contact directly' },
  { id: 'gap', label: 'Gap', max: 10, hint: 'Existing tools leave it unsolved' },
];
export const SCORE_MAX = Object.fromEntries(SCORE_PARTS.map((p) => [p.id, p.max]));

// `exploring` = you're validating it (talking to buyers, sketching the MVP).
export const PROBLEM_STATUSES = ['new', 'saved', 'exploring', 'dismissed'];

export const INDUSTRY_PRESETS = [
  'Dental practices',
  'HVAC & plumbing contractors',
  'Independent insurance agencies',
  'Property management',
  'Restaurants & cafés',
  'Auto repair shops',
  'Accounting & bookkeeping firms',
  'Physical therapy clinics',
];

export const DEFAULT_INDUSTRY_CONFIG = {
  builder: '',
  solution_types: ['web_app', 'automation', 'ai_tool', 'dashboard'],
  buyers: ['smb'],
  build_weeks: 4,
  avoid_regulated: true,
  home_base: '',
  local_first: false,
  avoid: '',
  max_searches: 20,
  target_results: 10,
};

const strList = (v) => (Array.isArray(v) ? [...new Set(v.map((s) => String(s).trim()).filter(Boolean))] : []);
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Merge a stored (possibly partial or stale) config over the defaults. */
export function normalizeIndustryConfig(raw) {
  const c = { ...DEFAULT_INDUSTRY_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const types = strList(c.solution_types).filter((t) => SOLUTION_TYPE_IDS.includes(t));
  const buyers = strList(c.buyers).filter((b) => BUYER_IDS.includes(b));
  return {
    builder: String(c.builder || ''),
    solution_types: types.length ? types : [...DEFAULT_INDUSTRY_CONFIG.solution_types],
    buyers: buyers.length ? buyers : [...DEFAULT_INDUSTRY_CONFIG.buyers],
    build_weeks: clampInt(c.build_weeks, 1, 26, DEFAULT_INDUSTRY_CONFIG.build_weeks),
    avoid_regulated: c.avoid_regulated !== false,
    home_base: String(c.home_base || ''),
    local_first: c.local_first === true,
    avoid: String(c.avoid || ''),
    max_searches: clampInt(c.max_searches, 5, 40, DEFAULT_INDUSTRY_CONFIG.max_searches),
    target_results: clampInt(c.target_results, 4, 25, DEFAULT_INDUSTRY_CONFIG.target_results),
  };
}

/** Attainability is judged against what the person can build, so the agent needs that. */
export const isIndustryConfigReady = (c) => Boolean(String(c?.builder || '').trim());

/** Clean what the user typed into the industry / focus boxes (single line, bounded). */
export const cleanIndustry = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
export const cleanFocus = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);

export const industrySlug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
