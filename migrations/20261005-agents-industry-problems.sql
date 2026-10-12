-- Industry Problems Agent. Mirrored at the end of supabase-schema.sql.
-- Run once against an existing Supabase project. It is safe to re-run.
-- Requires agent_configs (created by 20260913-agents-opportunities.sql).

create table if not exists industry_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_at timestamptz default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','complete','error')),
  error text,
  industry text not null,
  industry_key text not null,
  focus text not null default '',
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
create index if not exists industry_runs_user on industry_runs(user_id, run_at desc);

create table if not exists industry_problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_id uuid references industry_runs(id) on delete set null,
  dedupe_key text not null,
  industry_key text not null,
  industry text not null,
  map_key text,
  title text not null,
  problem text not null,
  who text,
  stage text,
  solution text,
  mvp text,
  solution_type text check (solution_type in ('web_app','automation','ai_tool','dashboard','mobile','extension','service')),
  build_weeks int,
  pricing text,
  reach text,
  competition text,
  evidence jsonb not null default '[]'::jsonb,
  evidence_verified int not null default 0,
  scores jsonb not null default '{}'::jsonb,
  score int not null default 0,
  risk text,
  status text not null default 'new' check (status in ('new','saved','exploring','dismissed')),
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  unique (user_id, dedupe_key)
);
create index if not exists industry_problems_user_industry on industry_problems(user_id, industry_key, score desc);

do $$
declare
  t text;
begin
  foreach t in array array['industry_runs','industry_problems'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;
