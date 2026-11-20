-- Drop the retired Agents folder tables (Opportunities + Industry Problems agents).
-- The feature was removed from the app on 2026-11-19. This permanently deletes
-- their data. Safe to re-run. Children first, then the run tables they point at.
drop table if exists industry_problems cascade;
drop table if exists industry_runs cascade;
drop table if exists opportunities cascade;
drop table if exists opportunity_runs cascade;
drop table if exists agent_configs cascade;
