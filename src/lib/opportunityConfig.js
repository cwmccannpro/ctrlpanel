// ============================================================
// CTRLpanel — Opportunities Agent config (shared)
// Plain JS with no browser or Node APIs, so the page, the config modal and
// the backend (backend/opportunities.js, backend/claude.js) all import it.
// Stored per user in agent_configs.config (agent_key = 'opportunities').
// ============================================================

export const OPPORTUNITIES_AGENT_KEY = 'opportunities';

// `badge` is the singular label on a result row, `short` the filter tab.
export const OPPORTUNITY_KINDS = [
  { id: 'job', label: 'Jobs', short: 'Jobs', badge: 'Job' },
  { id: 'internship', label: 'Internships', short: 'Internships', badge: 'Internship' },
  { id: 'program', label: 'Programs & fellowships', short: 'Programs', badge: 'Program' },
  { id: 'event', label: 'Events & conferences', short: 'Events', badge: 'Event' },
  { id: 'certification', label: 'Certifications & courses', short: 'Certifications', badge: 'Certification' },
  { id: 'competition', label: 'Competitions & hackathons', short: 'Competitions', badge: 'Competition' },
];
export const OPPORTUNITY_KIND_IDS = OPPORTUNITY_KINDS.map((k) => k.id);
export const KIND_BADGE = Object.fromEntries(OPPORTUNITY_KINDS.map((k) => [k.id, k.badge]));

// Suggestions shown as toggle chips in the config modal (none selected by default).
export const INDUSTRY_PRESETS = [
  'Technology',
  'Finance',
  'Mathematics',
  'Drug Development / Pharma',
  'Actuarial',
  'Data & AI',
  'Healthcare IT',
  'Insurance',
  'Quant / Trading',
];
export const CITY_PRESETS = ['Rochester, NY', 'Syracuse, NY', 'Toronto, ON', 'Pittsburgh, PA', 'Erie, PA', 'Cleveland, OH'];
export const EXPERIENCE_LEVELS = ['Student', 'Early career (0–2 yrs)', 'Mid career (3–7 yrs)', 'Senior (8+ yrs)'];

// Web searches per run. Estimates cover Claude Opus 5 tokens + $10 / 1,000 searches.
export const SEARCH_DEPTHS = [
  { value: 10, label: 'Quick', estimate: '≈ $0.50' },
  { value: 20, label: 'Standard', estimate: '≈ $1' },
  { value: 30, label: 'Deep', estimate: '≈ $1.50' },
];
export const RESULT_TARGETS = [10, 15, 20, 30];

export const DEFAULT_OPPORTUNITY_CONFIG = {
  profile: '',
  focus: '',
  industries: [],
  kinds: [...OPPORTUNITY_KIND_IDS],
  level: 'Early career (0–2 yrs)',
  home_base: '',
  cities: [],
  remote_us: true,
  nationwide: true,
  include_keywords: '',
  exclude_keywords: '',
  examples: '',
  max_searches: 20,
  target_results: 20,
};

const strList = (v) => (Array.isArray(v) ? [...new Set(v.map((s) => String(s).trim()).filter(Boolean))] : []);
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Merge a stored (possibly partial or stale) config over the defaults. */
export function normalizeConfig(raw) {
  const c = { ...DEFAULT_OPPORTUNITY_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const kinds = strList(c.kinds).filter((k) => OPPORTUNITY_KIND_IDS.includes(k));
  return {
    profile: String(c.profile || ''),
    focus: String(c.focus || ''),
    industries: strList(c.industries),
    kinds: kinds.length ? kinds : [...OPPORTUNITY_KIND_IDS],
    level: String(c.level || DEFAULT_OPPORTUNITY_CONFIG.level),
    home_base: String(c.home_base || ''),
    cities: strList(c.cities),
    remote_us: c.remote_us !== false,
    nationwide: c.nationwide !== false,
    include_keywords: String(c.include_keywords || ''),
    exclude_keywords: String(c.exclude_keywords || ''),
    examples: String(c.examples || ''),
    max_searches: clampInt(c.max_searches, 5, 40, DEFAULT_OPPORTUNITY_CONFIG.max_searches),
    target_results: clampInt(c.target_results, 5, 40, DEFAULT_OPPORTUNITY_CONFIG.target_results),
  };
}

/** The agent needs at least a profile or a current focus to rank against. */
export const isConfigReady = (c) => Boolean(String(c?.profile || '').trim() || String(c?.focus || '').trim());
