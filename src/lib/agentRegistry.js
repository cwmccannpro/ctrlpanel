// ============================================================
// CTRLpanel — Agents folder registry
// The sidebar's Agents folder and the /agents overview both read this list.
// To add an agent: add an entry here, build its page, and register its route
// in src/main.jsx. `runsTable` / `itemsTable` feed the overview card's
// "last run" and "new" counts (both are RLS "own rows" tables).
// ============================================================
export const AGENTS = [
  {
    key: 'opportunities',
    name: 'Opportunities Agent',
    icon: 'ti-target',
    to: '/agents/opportunities',
    description:
      'Finds and ranks jobs, programs, events, certifications and competitions that fit your profile — remote across the US or within reach of home.',
    runsTable: 'opportunity_runs',
    itemsTable: 'opportunities',
    itemsLabel: 'new',
  },
  {
    key: 'industry_problems',
    name: 'Industry Problems Agent',
    icon: 'ti-sitemap',
    to: '/agents/industry-problems',
    description:
      'Maps how an industry works and mines reviews, forums and job posts for narrow problems a solo builder could realistically solve.',
    runsTable: 'industry_runs',
    itemsTable: 'industry_problems',
    itemsLabel: 'new',
  },
];
