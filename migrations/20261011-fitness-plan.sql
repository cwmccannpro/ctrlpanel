-- ============================================================
-- Fitness is now a weekly training plan (split + exercises per weekday).
-- Adds the per-day exercise list. Safe to run more than once; existing
-- fitness_schedule rows keep their day/type and read as "no exercises yet".
-- workout_logs is left untouched (retired from the UI, history kept).
-- ============================================================
alter table fitness_schedule add column if not exists exercises jsonb not null default '[]'::jsonb;
