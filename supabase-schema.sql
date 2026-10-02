-- CTRLpanel — Supabase Schema (multi-user with Auth + Row-Level Security)
-- Run this entire file in your Supabase SQL Editor:
--   supabase.com → your project → SQL Editor → New Query → paste → Run
--
-- Every data table is scoped to the logged-in user via `user_id`, which
-- defaults to auth.uid() (the current user from their JWT) and is protected
-- by RLS so users can only ever read/write their own rows. New accounts
-- start empty — no seed data.

-- ============================================
-- PROFILES  (one row per auth user)
-- ============================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz default now()
);

-- ============================================
-- USER SETTINGS  (accent, display prefs, connectors)
-- ============================================
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  accent_color text default '#e11d48',
  sidebar_collapsed boolean default false,
  font_size text default 'Medium',
  connectors jsonb default '[]'::jsonb,
  birthdate date,
  life_expectancy integer default 90,
  show_life_widget boolean default false,
  ui_preferences jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Life View / dashboard widget prefs (safe to re-run on existing installs)
alter table user_settings add column if not exists birthdate date;
alter table user_settings add column if not exists life_expectancy integer default 90;
alter table user_settings add column if not exists show_life_widget boolean default false;
alter table user_settings add column if not exists dashboard_widgets jsonb;
alter table user_settings add column if not exists ui_preferences jsonb default '{}'::jsonb;

-- Atomically merge one UI preference section without overwriting preferences
-- saved by another page or browser tab.
create or replace function public.merge_ui_preferences(section_key text, patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  merged jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if section_key is null or btrim(section_key) = '' then
    raise exception 'Preference section is required';
  end if;
  if jsonb_typeof(coalesce(patch, '{}'::jsonb)) <> 'object' then
    raise exception 'Preference patch must be a JSON object';
  end if;

  insert into user_settings (user_id, ui_preferences, updated_at)
  values (
    auth.uid(),
    jsonb_build_object(section_key, coalesce(patch, '{}'::jsonb)),
    now()
  )
  on conflict (user_id) do update
  set ui_preferences = jsonb_set(
        coalesce(user_settings.ui_preferences, '{}'::jsonb),
        array[section_key],
        coalesce(user_settings.ui_preferences -> section_key, '{}'::jsonb)
          || coalesce(patch, '{}'::jsonb),
        true
      ),
      updated_at = now()
  returning ui_preferences into merged;

  return merged;
end;
$$;

revoke all on function public.merge_ui_preferences(text, jsonb) from public;
grant execute on function public.merge_ui_preferences(text, jsonb) to authenticated;

-- ============================================
-- TASKS & BOARDS
-- ============================================
create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  project_id uuid,
  columns jsonb default '["Backlog","In Progress","Review","Done"]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,
  board_id uuid references boards(id) on delete cascade,
  column_name text default 'Backlog',
  priority text default 'Medium' check (priority in ('Low','Medium','High','Urgent')),
  due_date date,
  labels jsonb default '[]'::jsonb,
  project_id text,
  created_at timestamptz default now()
);

-- ============================================
-- PROJECTS
-- ============================================
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  status text default 'Active' check (status in ('Active','Paused','Complete')),
  description text,
  goal text,
  color text default '#e11d48',
  notes text,
  files jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Project Dashboard restructure (safe to re-run on existing installs):
-- charter = { summary, objective, metrics: [{label, value}] }
-- notes_list = [{ id, title, content, pinned, updated_at }]  (replaces the single `notes` blob)
-- excalidraw = serialized scene { elements, appState, files }; excalidraw_preview = webp data URL
alter table projects add column if not exists charter jsonb default '{}'::jsonb;
alter table projects add column if not exists notes_list jsonb default '[]'::jsonb;
alter table projects add column if not exists excalidraw jsonb;
alter table projects add column if not exists excalidraw_preview text;
-- Per-project Services quick-links bar: [{ id, label, url, icon, paid }]
alter table projects add column if not exists service_links jsonb default '[]'::jsonb;

-- Link a project to a single To Do board (mirrors crm_board_id below).
alter table projects add column if not exists todo_board_id uuid references boards(id) on delete set null;

-- ============================================
-- CRM
-- ============================================
create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  business_name text,
  phone text,
  email text,
  business_type text,
  service text,
  lead_temp text default 'Cold' check (lead_temp in ('Cold','Warm','Hot')),
  rating numeric,
  total_reviews integer,
  opening_hours text,
  search_location text,
  times_called integer default 0,
  last_touch date,
  left_voicemail boolean default false,
  notes text,
  created_at timestamptz default now()
);

-- ============================================
-- HEALTH: NUTRITION
-- ============================================
create table if not exists nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meal_name text,
  calories numeric,
  protein numeric,
  carbs numeric,
  fat numeric,
  micros jsonb default '{}'::jsonb,
  photo_url text,
  logged_at timestamptz default now()
);

create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weight numeric not null,
  logged_at timestamptz default now()
);

create table if not exists user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  calories numeric default 2400,
  protein numeric default 180,
  carbs numeric default 250,
  fat numeric default 80,
  updated_at timestamptz default now()
);

-- ============================================
-- HEALTH: SUPPLEMENTS
-- ============================================
create table if not exists supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  dose text,
  timing text check (timing in ('Morning','Afternoon','Evening','Night')),
  enabled boolean default true,
  units_remaining integer,
  notes text,
  created_at timestamptz default now()
);

create table if not exists supplement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplement_id uuid references supplements(id) on delete cascade,
  taken_at timestamptz default now()
);

-- ============================================
-- HEALTH: FITNESS
-- ============================================
create table if not exists fitness_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day_of_week text,
  workout_type text,
  notes text
);

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_type text,
  completed_at timestamptz default now(),
  exercises jsonb default '[]'::jsonb,
  notes text
);

-- ============================================
-- HABITS  (custom habits + daily completion log)
-- ============================================
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid references habits(id) on delete cascade,
  log_date date not null default current_date,
  completed boolean default true,
  created_at timestamptz default now(),
  unique (habit_id, log_date)
);

-- ============================================
-- FINANCE: NET WORTH
-- ============================================
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text check (type in ('Checking','Savings','Investment','Crypto','Real Estate','Vehicle','Liability')),
  balance numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  total numeric not null,
  snapshot_date date default current_date
);

-- ============================================
-- FINANCE: BUDGET
-- ============================================
create table if not exists income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null,
  frequency text,
  type text,
  created_at timestamptz default now()
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text default 'Variable' check (type in ('Fixed','Variable')),
  budgeted numeric default 0,
  created_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric not null,
  category_id uuid references expense_categories(id),
  note text,
  date date default current_date,
  recurring boolean default false,
  created_at timestamptz default now()
);

-- ============================================
-- FINANCE: INVESTING
-- ============================================
create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text,
  name text,
  asset_class text check (asset_class in ('Stocks','ETFs','Crypto','Real Estate','Other')),
  shares numeric,
  avg_cost numeric,
  manual_price numeric,
  created_at timestamptz default now()
);

create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  total_value numeric not null,
  snapshot_date date default current_date
);

create table if not exists dividends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  holding_id uuid references holdings(id) on delete cascade,
  amount numeric not null,
  paid_date date,
  created_at timestamptz default now()
);

-- ============================================
-- CALENDAR EVENTS
-- ============================================
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  calendar text default 'Personal',
  color text default '#e11d48',
  created_at timestamptz default now()
);

-- ============================================
-- CRM BOARDS (multiple CRM pages) + custom columns + project link
-- ============================================
create table if not exists crm_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  columns jsonb default '[]'::jsonb,   -- custom column defs: [{ key, label }]
  created_at timestamptz default now()
);

-- Link contacts to a board + hold custom column values; link projects to a board.
alter table crm_contacts add column if not exists board_id uuid references crm_boards(id) on delete set null;
alter table crm_contacts add column if not exists custom jsonb default '{}'::jsonb;
alter table projects add column if not exists crm_board_id uuid references crm_boards(id) on delete set null;

-- ============================================
-- GOOGLE CALENDAR TOKENS (backend-managed, never client-readable)
-- ============================================
create table if not exists google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  scope text,
  token_type text,
  expiry_date bigint,
  google_email text,
  updated_at timestamptz default now()
);

-- ============================================
-- NEW-USER TRIGGER: provision profile + settings
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- ROW-LEVEL SECURITY
-- Enable RLS + an "own rows only" policy on every table.
-- ============================================
do $$
declare
  t text;
  -- profiles + user_settings key on a different column than user_id
  data_tables text[] := array[
    'boards','tasks','projects','crm_contacts','nutrition_logs','weight_logs',
    'user_goals','supplements','supplement_logs','fitness_schedule','workout_logs',
    'accounts','net_worth_snapshots','income_sources','expense_categories',
    'transactions','holdings','portfolio_snapshots','dividends',
    'calendar_events','crm_boards','habits','habit_logs'
  ];
begin
  foreach t in array data_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;

  -- profiles (keyed by id)
  execute 'alter table profiles enable row level security';
  execute 'drop policy if exists "own profile" on profiles';
  execute 'create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id)';

  -- user_settings (keyed by user_id, primary key)
  execute 'alter table user_settings enable row level security';
  execute 'drop policy if exists "own settings" on user_settings';
  execute 'create policy "own settings" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id)';

  -- google_tokens: RLS on with NO policy — only the backend service_role key
  -- may read/write OAuth tokens; the browser client can never see them.
  execute 'alter table google_tokens enable row level security';
end $$;

-- ============================================
-- NUTRITION: external API logging + water
-- ============================================
alter table nutrition_logs add column if not exists notes text;

-- Per-user API keys for the external logging endpoint (custom GPT).
-- Only a SHA-256 hash is stored; the plaintext key is shown once in Settings.
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'API key',
  key_prefix text,
  key_hash text unique not null,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric not null,          -- fluid ounces
  logged_at timestamptz default now()
);

alter table user_goals add column if not exists water numeric default 64;

-- RLS for the new tables
do $$
declare
  t text;
begin
  -- Standard per-user tables
  foreach t in array array['api_keys','water_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;

end $$;

-- ============================================
-- RETIRED FEATURES
-- The old Agents + Email Triage tables are dropped here (safe to re-run;
-- drops data for those tables). Never reuse these names for new tables —
-- the current Agents folder uses agent_configs / opportunity_* below.
--
-- The Reports feature (report_sources, reports, the `reports` storage bucket
-- and its policies) was removed from the app; its tables and files are
-- intentionally left in place in existing databases and are no longer
-- defined here.
-- ============================================
drop table if exists triage_items cascade;
drop table if exists triage_runs cascade;
drop table if exists gmail_accounts cascade;
drop table if exists agent_runs cascade;
drop table if exists agents cascade;

-- ============================================
-- SOCIALS: YouTube channel analytics
-- One row per connected channel, holding OAuth tokens + cached stats. Tokens
-- make this service-role only (RLS enabled, NO policy) — the browser sees
-- channel metadata + analytics only through /api/youtube/*. Modular: a user
-- can connect multiple Google accounts / channels.
-- ============================================
create table if not exists youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  title text,
  label text, -- user's own name for the sidebar section (falls back to title)
  thumbnail text,
  subscriber_count bigint,
  video_count bigint,
  view_count bigint,
  google_email text,
  access_token text,
  refresh_token text,
  scope text,
  token_type text,
  expiry_date bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, channel_id)
);
create index if not exists youtube_channels_user on youtube_channels(user_id);

do $$ begin
  execute 'alter table youtube_channels enable row level security';
end $$;

-- ============================================
-- GOOGLE SHEETS-BACKED CRM
-- A CRM board can be linked to a Google Spreadsheet, which then becomes the
-- source of truth for that board (read live, edits written straight back).
-- Auth is a server-side SERVICE ACCOUNT (see backend/sheets.js) — Google
-- restricts the Sheets OAuth scope to HTTPS-only clients, which rules out
-- localhost dev. So there are no per-user tokens to store here; the user
-- shares each spreadsheet with the service account address instead.
-- ============================================
drop table if exists google_sheets_tokens;

-- Link a CRM board to one spreadsheet + the tab it shows by default.
alter table crm_boards add column if not exists spreadsheet_id text;
alter table crm_boards add column if not exists spreadsheet_url text;
alter table crm_boards add column if not exists spreadsheet_title text;
alter table crm_boards add column if not exists sheet_name text;

-- ============================================
-- Done. Enable Email auth under Authentication → Providers,
-- then register your first account in the app.
-- ============================================

-- KNOWLEDGE BASE: private Markdown context, linked into per-project graphs.
create table if not exists knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  content text not null default '',
  folder text not null default '',
  tags text[] not null default '{}',
  aliases text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_notes_user_updated on knowledge_notes(user_id, updated_at desc);
create index if not exists knowledge_notes_project on knowledge_notes(project_id);
do $$
declare t text;
begin
  foreach t in array array['knowledge_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
-- Even a guessed project UUID cannot attach private context to another owner.
drop policy if exists "knowledge own project" on knowledge_notes;
create policy "knowledge own project" on knowledge_notes as restrictive for all
  using (auth.uid() = user_id)
  with check (project_id is null or exists (
    select 1 from projects p where p.id = project_id and p.user_id = auth.uid()
  ));

-- CONTEXT SYNC: revocable external clients and stable note identities.
alter table knowledge_notes add column if not exists external_key text;
create unique index if not exists knowledge_external_key on knowledge_notes(user_id, external_key) where external_key is not null;
create table if not exists knowledge_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text unique not null,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['knowledge_api_keys'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
-- Every writer gets a database-assigned version, including browser edits.
create or replace function public.knowledge_stamp() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists knowledge_stamp on knowledge_notes;
create trigger knowledge_stamp before update on knowledge_notes for each row execute function public.knowledge_stamp();

-- One note per stable external key. A stale writer must read and merge first.
create or replace function public.save_context_note(p_user uuid, p_key text, p_title text, p_folder text, p_content text, p_expected timestamptz default null)
returns knowledge_notes language plpgsql security invoker set search_path=public as $$
declare existing knowledge_notes; result knowledge_notes;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_key, 0));
  select * into existing from knowledge_notes where user_id=p_user and external_key=p_key for update;
  if found then
    if existing.title=p_title and existing.folder=p_folder and existing.content=p_content then return existing; end if;
    if p_expected is null or existing.updated_at <> p_expected then raise exception 'Context changed; read the latest note and merge before saving.' using errcode='40001'; end if;
    update knowledge_notes set title=p_title,folder=p_folder,content=p_content,
      aliases=case when title<>p_title or folder<>p_folder then array_append(array_append(aliases,title),case when folder='' then title else folder||'/'||title end) else aliases end
      where id=existing.id returning * into result;
  else
    if p_expected is not null then raise exception 'Note no longer exists; read before saving.' using errcode='40001'; end if;
    insert into knowledge_notes(user_id,external_key,title,folder,content) values(p_user,p_key,p_title,p_folder,p_content) returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.save_context_note(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_context_note(uuid,text,text,text,text,timestamptz) to service_role;
do $$ begin alter publication supabase_realtime add table knowledge_notes;
exception when duplicate_object then null; end $$;

-- ============================================
-- PERSONAL-ONLY MODE: retire collaboration access without deleting history.
-- Existing invite/friend/challenge rows are intentionally preserved, but no
-- browser or API surface can use them. Boards and tasks fall back to their
-- standard owner-only RLS policies above.
-- ============================================
drop policy if exists "shared boards read" on boards;
drop policy if exists "shared boards update" on boards;
drop policy if exists "shared board tasks" on tasks;
do $$ begin
  if to_regclass('public.board_shares') is not null then
    execute 'drop policy if exists "share parties read" on public.board_shares';
    execute 'drop policy if exists "share parties delete" on public.board_shares';
  end if;
end $$;
drop function if exists public.can_access_board(uuid);
drop function if exists public.is_board_owner(uuid);

-- ============================================
-- AGENTS folder — per-agent config + the Opportunities Agent
-- agent_configs: one row per user per agent (agent_key), settings in config.
-- opportunity_runs: one row per on-demand run, written by the backend with
--   the verified session's user_id; `summary` holds the skills-to-build list.
-- opportunities: ranked finds, unique per user on dedupe_key (normalized URL).
--   `status` belongs to the user — later runs never overwrite it.
-- Named agent_configs / opportunity_* on purpose: `agents` / `agent_runs` are
-- dropped by the retired-features block above.
-- ============================================
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
  summary jsonb not null default '{}'::jsonb,   -- { headline, skill_gaps:[{skill,why,how_to_learn,url}], market_notes }
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
  dedupe_key text not null,                       -- normalized URL (or org::title)
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
  score int not null default 0,                   -- 0-100 fit
  reasons text[] not null default '{}',
  source_verified boolean not null default false, -- link host appeared in the search results
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
