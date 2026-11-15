-- Agents folder + Opportunities Agent. Extracted from supabase-schema.sql.
-- Run once against an existing Supabase project. It is safe to re-run.
-- (The Reports feature's tables and storage bucket are left untouched.)

create table if not exists agent_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  agent_key text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, agent_key)
);

create table if not exists opportunity_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_at timestamptz default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','complete','error')),
  error text,
  summary jsonb not null default '{}'::jsonb,
  found int not null default 0,
  added int not null default 0,
  searches int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  model text,
  config_snapshot jsonb not null default '{}'::jsonb
);
create index if not exists opportunity_runs_user on opportunity_runs(user_id, run_at desc);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_id uuid references opportunity_runs(id) on delete set null,
  dedupe_key text not null,
  kind text not null check (kind in ('job','internship','program','event','certification','competition')),
  title text not null,
  org text,
  industry text,
  location text,
  mode text check (mode in ('remote','in_person','hybrid')),
  starts_on date,
  deadline date,
  cost text,
  is_free boolean not null default false,
  url text,
  score int not null default 0,
  reasons text[] not null default '{}',
  source_verified boolean not null default false,
  status text not null default 'new' check (status in ('new','saved','applied','dismissed')),
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  unique (user_id, dedupe_key)
);
create index if not exists opportunities_user_score on opportunities(user_id, score desc);

do $$
declare
  t text;
begin
  foreach t in array array['agent_configs','opportunity_runs','opportunities'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;
