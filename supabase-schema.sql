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

-- Parent board for a project's To Do column (mirrors crm_board_id below).
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
-- Weekly plan: the exercises for that weekday, [{ id, name, sets, reps, weight, note }].
alter table fitness_schedule add column if not exists exercises jsonb not null default '[]'::jsonb;

-- Retired: Fitness no longer logs workouts (it only holds the weekly plan). Table kept for history.
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
-- drops data for those tables). Never reuse these names for new tables.
--
-- The Agents folder (Opportunities + Industry Problems agents) was removed
-- from the app on 2026-11-19 and its tables are dropped below too
-- (migrations/20261119-drop-agents-tables.sql).
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
drop table if exists industry_problems cascade;
drop table if exists industry_runs cascade;
drop table if exists opportunities cascade;
drop table if exists opportunity_runs cascade;
drop table if exists agent_configs cascade;

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
-- SOCIALS: Instagram account analytics
-- One row per connected Instagram professional (Business/Creator) account,
-- holding the 60-day access token + cached counts. Same pattern as
-- youtube_channels: RLS enabled with NO policy, so only the service-role
-- backend can read it — the browser sees metadata + analytics only through
-- /api/instagram/*.
-- ============================================
create table if not exists instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  name text,
  label text, -- user's own name for the sidebar section (falls back to @username)
  account_type text,
  profile_picture_url text,
  followers_count bigint,
  follows_count bigint,
  media_count bigint,
  access_token text,
  scope text,
  expires_at bigint, -- ms epoch; long-lived tokens last 60 days, refreshed on use
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, ig_user_id)
);
create index if not exists instagram_accounts_user on instagram_accounts(user_id);

do $$ begin
  execute 'alter table instagram_accounts enable row level security';
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
-- PROJECT KNOWLEDGE + MARKDOWN VAULT SYNC
-- Project-aware external writes verify ownership atomically.
-- ============================================
-- Claim a browser-created note (which has no external key) for a vault.
create or replace function public.claim_context_note(
  p_user uuid,
  p_note uuid,
  p_key text,
  p_expected timestamptz
)
returns knowledge_notes
language plpgsql
security invoker
set search_path = public
as $$
declare existing knowledge_notes; result knowledge_notes;
begin
  select * into existing from knowledge_notes where id = p_note and user_id = p_user for update;
  if not found then
    raise exception 'Note is unavailable.' using errcode = '42501';
  end if;
  if existing.external_key = p_key then
    return existing;
  end if;
  if existing.external_key is not null or p_expected is null or existing.updated_at <> p_expected then
    raise exception 'Note changed or is already linked.' using errcode = '40001';
  end if;
  update knowledge_notes set external_key = p_key where id = p_note returning * into result;
  return result;
end $$;
revoke all on function public.claim_context_note(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_context_note(uuid,uuid,text,timestamptz) to service_role;

create or replace function public.save_context_note_v2(
  p_user uuid,
  p_key text,
  p_title text,
  p_folder text,
  p_content text,
  p_project uuid,
  p_set_project boolean,
  p_expected timestamptz
)
returns knowledge_notes
language plpgsql
security invoker
set search_path = public
as $$
declare existing knowledge_notes; result knowledge_notes;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_key, 0));
  if p_set_project and p_project is not null and not exists (
    select 1 from projects where id = p_project and user_id = p_user
  ) then
    raise exception 'Project is unavailable.' using errcode = '42501';
  end if;
  select * into existing from knowledge_notes where user_id = p_user and external_key = p_key for update;
  if found then
    if existing.title = p_title and existing.folder = p_folder and existing.content = p_content
      and (not p_set_project or existing.project_id is not distinct from p_project) then
      return existing;
    end if;
    if p_expected is null or existing.updated_at <> p_expected then
      raise exception 'Context changed; read the latest note and merge before saving.' using errcode = '40001';
    end if;
    update knowledge_notes set
      title = p_title,
      folder = p_folder,
      content = p_content,
      project_id = case when p_set_project then p_project else project_id end,
      aliases = case when title <> p_title or folder <> p_folder
        then array_append(array_append(aliases, title), case when folder = '' then title else folder || '/' || title end)
        else aliases end
    where id = existing.id returning * into result;
  else
    if p_expected is not null then
      raise exception 'Note no longer exists; read before saving.' using errcode = '40001';
    end if;
    insert into knowledge_notes(user_id,external_key,title,folder,content,project_id)
    values(p_user,p_key,p_title,p_folder,p_content,case when p_set_project then p_project else null end)
    returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.save_context_note_v2(uuid,text,text,text,text,uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.save_context_note_v2(uuid,text,text,text,text,uuid,boolean,timestamptz) to service_role;

-- The one-time import of legacy project notes lives in migrations/20261005-project-knowledge-vault-sync.sql.
-- Reapplying the schema must preserve intentional note deletions.

-- SOCIAL CONNECTIONS: YouTube, Instagram and X (2026-10-11)
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
-- SOCIALS: Instagram account analytics
-- One row per connected Instagram professional (Business/Creator) account,
-- holding the 60-day access token + cached counts. Same pattern as
-- youtube_channels: RLS enabled with NO policy, so only the service-role
-- backend can read it — the browser sees metadata + analytics only through
-- /api/instagram/*.
-- ============================================
create table if not exists instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  name text,
  label text, -- user's own name for the sidebar section (falls back to @username)
  account_type text,
  profile_picture_url text,
  followers_count bigint,
  follows_count bigint,
  media_count bigint,
  access_token text,
  scope text,
  expires_at bigint, -- ms epoch; long-lived tokens last 60 days, refreshed on use
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, ig_user_id)
);
create index if not exists instagram_accounts_user on instagram_accounts(user_id);

do $$ begin
  execute 'alter table instagram_accounts enable row level security';
end $$;

-- ============================================
-- Social token tables are backend-only. Ownership is checked on every API call.
create table if not exists x_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  x_user_id text not null,
  username text,
  name text,
  label text,
  profile_image_url text,
  followers_count bigint,
  following_count bigint,
  tweet_count bigint,
  access_token text,
  refresh_token text,
  scope text,
  expires_at bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, x_user_id)
);
create index if not exists x_accounts_user on x_accounts(user_id);
alter table youtube_channels add column if not exists label text;
do $$
declare t text;
begin
  foreach t in array array['youtube_channels','instagram_accounts','x_accounts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I alter column user_id set default auth.uid()', t);
    -- Token tables have NO browser policy, and no browser grants.
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;
-- Existing tables already have owner-only RLS. No new rows or reference data.
alter table nutrition_logs add column if not exists micros jsonb default '{}'::jsonb;
alter table user_goals add column if not exists micros jsonb not null default '{}'::jsonb;

-- Patch one nutrient atomically so edits from multiple panels preserve other targets.
create or replace function public.set_nutrition_target(nutrient text, target numeric)
returns setof public.user_goals
language plpgsql security invoker set search_path = public as $$
declare goal_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to edit nutrition targets.'; end if;
  if target is null or target < 0 or target > 100000 or target::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid nutrition target.';
  end if;
  if nutrient not in ('calories','protein','carbs','fat','fiber','vitamin_d','calcium','iron','potassium','magnesium','vitamin_c','vitamin_b12','zinc','sodium','vitamin_a','vitamin_e','vitamin_k','thiamin','riboflavin','niacin','pantothenic_acid','vitamin_b6','biotin','folate','choline','phosphorus','iodine','selenium','copper','manganese','chromium','molybdenum','chloride','saturated_fat','added_sugar','cholesterol') then
    raise exception 'Unknown nutrient.';
  end if;
  -- Also serialize the initial empty-account insert without a new unique index.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':nutrition-goals', 0));
  select id into goal_id from user_goals where user_id = auth.uid() order by updated_at desc, id desc limit 1 for update;
  if goal_id is null then insert into user_goals default values returning id into goal_id; end if;
  if nutrient in ('calories','protein','carbs','fat') then
    execute format('update public.user_goals set %I = $1, updated_at = now() where id = $2', nutrient) using target, goal_id;
  else
    update user_goals set micros = coalesce(micros, '{}'::jsonb) || jsonb_build_object(nutrient, target), updated_at = now() where id = goal_id;
  end if;
  return query select * from user_goals where id = goal_id;
end;
$$;
revoke all on function public.set_nutrition_target(text, numeric) from public;
grant execute on function public.set_nutrition_target(text, numeric) to authenticated;

-- ============================================================
-- AI usage ledger (migrations/20261012-ai-usage.sql)
-- ============================================================
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant all on table public.ai_usage to service_role;

-- Reserve one request and its estimated cost for today, or refuse when either
-- daily cap would be exceeded. Row-locked, so concurrent calls can't overshoot.
create or replace function public.ai_usage_reserve(p_user uuid, p_est_usd numeric, p_max_usd numeric, p_max_requests integer)
returns table (allowed boolean, reason text, out_day date, out_requests integer, out_cost_usd numeric)
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  u public.ai_usage;
begin
  insert into public.ai_usage (user_id, day) values (p_user, d) on conflict (user_id, day) do nothing;
  select * into u from public.ai_usage a where a.user_id = p_user and a.day = d for update;
  if u.requests >= p_max_requests then
    return query select false, 'requests'::text, d, u.requests, u.cost_usd;
    return;
  end if;
  if u.cost_usd + p_est_usd > p_max_usd then
    return query select false, 'spend'::text, d, u.requests, u.cost_usd;
    return;
  end if;
  update public.ai_usage a
    set requests = a.requests + 1, cost_usd = a.cost_usd + p_est_usd, updated_at = now()
    where a.user_id = p_user and a.day = d
    returning * into u;
  return query select true, ''::text, d, u.requests, u.cost_usd;
end;
$$;

-- Replace the reserved estimate with the real cost (delta) and add token counts.
create or replace function public.ai_usage_settle(p_user uuid, p_day date, p_delta_usd numeric, p_input bigint, p_output bigint)
returns void
language sql security definer set search_path = public as $$
  update public.ai_usage a
    set cost_usd = greatest(0, a.cost_usd + p_delta_usd),
        input_tokens = a.input_tokens + greatest(p_input, 0),
        output_tokens = a.output_tokens + greatest(p_output, 0),
        updated_at = now()
    where a.user_id = p_user and a.day = p_day;
$$;

revoke all on function public.ai_usage_reserve(uuid, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.ai_usage_settle(uuid, date, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, numeric, numeric, integer) to service_role;
grant execute on function public.ai_usage_settle(uuid, date, numeric, bigint, bigint) to service_role;
-- Private outbound-only Windows BLE relay. Provision real hardware separately.
create table if not exists public.room_controllers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade unique,
  name text not null default 'Windows desktop',
  key_hash text unique,
  devices jsonb not null default '[]'::jsonb,
  last_sent jsonb not null default '{}'::jsonb,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.room_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  controller_id uuid not null references public.room_controllers(id) on delete cascade,
  targets jsonb not null,
  patch jsonb not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','partial','failed','expired','cancelled')),
  results jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  completed_at timestamptz
);
create index if not exists room_commands_queue on public.room_commands(controller_id, created_at);
-- No browser policies: even the owner uses the authenticated API. Controller
-- enrollment/configuration is server-only, so other accounts cannot claim it.
do $$ declare t text; begin
  foreach t in array array['room_controllers','room_commands'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.room_relay(p_action text, p_user uuid, p_hash text, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.room_controllers; cmd public.room_commands; result jsonb; item jsonb;
  successes integer := 0; recent jsonb; key_count integer;
begin
  if p_action in ('poll','ack') then
    if p_hash is null or p_user is not null then raise exception 'Invalid controller credential.' using errcode='42501'; end if;
    select * into c from public.room_controllers where key_hash = p_hash for update;
  elsif p_action in ('status','pair','revoke','command') then
    if p_user is null or p_hash is not null then raise exception 'A user session is required.' using errcode='42501'; end if;
    select * into c from public.room_controllers where user_id = p_user for update;
  else raise exception 'Unknown room action.' using errcode='22023'; end if;
  if c.id is null then raise exception 'No room controller is linked to this account.' using errcode='42501'; end if;

  update public.room_commands set status='expired', completed_at=now()
    where controller_id=c.id and status in ('queued','sending') and expires_at <= now();


  if p_action='status' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb) into recent
      from (select id,targets,patch,status,results,created_at,expires_at from public.room_commands
            where controller_id=c.id order by created_at desc limit 12) q;
    return jsonb_build_object('controller',jsonb_build_object('name',c.name,'paired',c.key_hash is not null,
      'devices',c.devices,'last_sent',c.last_sent,'last_seen',c.last_seen),'commands',recent);
  elsif p_action in ('pair','revoke') then
    if p_action='pair' and coalesce(p_body->>'key_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key hash.' using errcode='22023'; end if;
    update public.room_controllers set key_hash=case when p_action='pair' then p_body->>'key_hash' else null end,
      last_seen=null where id=c.id;
    update public.room_commands set status='cancelled',completed_at=now() where controller_id=c.id and status in ('queued','sending');
    return jsonb_build_object('ok',true);
  elsif p_action='command' then
    if c.key_hash is null or c.last_seen is null or c.last_seen < now()-interval '30 seconds' then
      raise exception 'Desktop is offline. Wake it and start the room bridge.' using errcode='55000'; end if;
    if jsonb_typeof(p_body->'targets') is distinct from 'array' or jsonb_array_length(p_body->'targets') not between 1 and 16
       or jsonb_typeof(p_body->'patch') is distinct from 'object' then raise exception 'Invalid light command.' using errcode='22023'; end if;
    select count(*) into key_count from jsonb_object_keys(p_body->'patch');
    if key_count != 1 or not (p_body->'patch' ?| array['power','brightness','color','temperature']) then
      raise exception 'Invalid light setting.' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_body->'targets') loop
      if not exists (select 1 from jsonb_array_elements(c.devices) d where d->>'id'=item#>>'{}'
        and (not (p_body->'patch' ? 'temperature') or d->>'cct'='true')) then
        raise exception 'Light is not configured for this setting.' using errcode='22023'; end if;
    end loop;
    if (select count(*) from public.room_commands where controller_id=c.id and created_at>now()-interval '1 minute') >= 60 then
      raise exception 'Too many changes. Wait a moment.' using errcode='54000'; end if;
    if (select count(*) from public.room_commands where controller_id=c.id and status in ('queued','sending')) >= 8 then
      raise exception 'The desktop is still sending changes. Wait a moment.' using errcode='54000'; end if;
    insert into public.room_commands(user_id,controller_id,targets,patch) values(c.user_id,c.id,p_body->'targets',p_body->'patch') returning * into cmd;
    return jsonb_build_object('id',cmd.id,'status',cmd.status);
  elsif p_action='poll' then
    update public.room_controllers set last_seen=now() where id=c.id;
    if not exists(select 1 from public.room_commands where controller_id=c.id and status='sending') then
      select * into cmd from public.room_commands where controller_id=c.id and status='queued' order by created_at,id limit 1 for update;
      if cmd.id is not null then update public.room_commands set status='sending' where id=cmd.id; end if;
    end if;
    return jsonb_build_object('devices',c.devices,'last_sent',c.last_sent,'command',case when cmd.id is null then null else
      jsonb_build_object('id',cmd.id,'targets',cmd.targets,'patch',cmd.patch,'expires_at',cmd.expires_at) end);
  elsif p_action='ack' then
    select * into cmd from public.room_commands where id=(p_body->>'id')::uuid and controller_id=c.id for update;
    if cmd.id is null then raise exception 'Unknown room command.' using errcode='42501'; end if;
    if cmd.status in ('sent','partial','failed') then return jsonb_build_object('ok',true); end if;
    if cmd.status != 'sending' then raise exception 'Command expired or was cancelled.' using errcode='55000'; end if;
    if jsonb_typeof(p_body->'results') is distinct from 'array' or jsonb_array_length(p_body->'results') != jsonb_array_length(cmd.targets) then
      raise exception 'A result is required for every light.' using errcode='22023'; end if;
    if (select count(distinct r->>'id') from jsonb_array_elements(p_body->'results') r) != jsonb_array_length(cmd.targets) then
      raise exception 'Duplicate light receipt.' using errcode='22023'; end if;
    for result in select value from jsonb_array_elements(p_body->'results') loop
      if not (cmd.targets ? (result->>'id')) or jsonb_typeof(result->'ok') is distinct from 'boolean' then
        raise exception 'Invalid light receipt.' using errcode='22023'; end if;
      if (result->>'ok')::boolean then
        successes := successes+1;
        c.last_sent := jsonb_set(c.last_sent,array[result->>'id'],coalesce(c.last_sent->(result->>'id'),'{}'::jsonb)
          || cmd.patch || jsonb_build_object('sent_at',now())
          || case when cmd.patch ? 'color' then '{"mode":"color"}'::jsonb when cmd.patch ? 'temperature' then '{"mode":"white"}'::jsonb else '{}'::jsonb end);
      end if;
    end loop;
    update public.room_controllers set last_seen=now(),last_sent=c.last_sent where id=c.id;
    update public.room_commands set results=p_body->'results',completed_at=now(),
      status=case when successes=0 then 'failed' when successes=jsonb_array_length(cmd.targets) then 'sent' else 'partial' end where id=cmd.id;
    return jsonb_build_object('ok',true);
  end if;
end $$;
revoke all on function public.room_relay(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.room_relay(text,uuid,text,jsonb) to service_role;

-- ============================================
-- ICLOUD CALENDAR (CalDAV) — migrations/20261116-icloud-caldav.sql
-- ============================================
-- iCloud Calendar read + write over CalDAV (backend/caldav.js).
-- One row per user: Apple ID + app-specific password, sealed with AES-256-GCM
-- by the backend before it is stored. Service-role only: RLS on with NO policy,
-- like google_tokens, so the browser can never read it. Safe to re-run.
create table if not exists public.caldav_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  secret text not null,
  principal_url text,
  home_url text not null,
  updated_at timestamptz default now()
);
alter table public.caldav_accounts enable row level security;
revoke all on public.caldav_accounts from anon, authenticated;



-- TikTok OAuth tokens are accessible only to the backend service role.
create table if not exists public.tiktok_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  open_id text not null,
  name text,
  label text,
  avatar_url text,
  followers_count bigint,
  following_count bigint,
  likes_count bigint,
  video_count bigint,
  access_token text not null,
  refresh_token text not null,
  scope text not null,
  expires_at bigint not null,
  refresh_expires_at bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, open_id)
);

alter table public.tiktok_accounts enable row level security;
revoke all on table public.tiktok_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.tiktok_accounts to service_role;

-- ============================================================
-- DESKTOP MODEL RELAY (meal estimates on the owner's PC) — migrations/20261121-local-ai.sql
-- ============================================================
-- Desktop model relay for meal estimates. The owner's Windows desktop polls
-- outbound over HTTPS with a ctla_ key; CTRLpanel hands it one meal at a time
-- while it reports a ready local model, and falls back to Claude otherwise.
create table if not exists public.local_ai_bridges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade unique,
  name text not null default 'Windows desktop',
  key_hash text unique,
  model text,
  ready boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.local_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id uuid not null references public.local_ai_bridges(id) on delete cascade,
  input jsonb, -- the photo/description; cleared the moment the desktop claims it
  status text not null default 'queued' check (status in ('queued','running','done','failed','expired')),
  result jsonb,
  error text,
  model text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  claimed_at timestamptz,
  completed_at timestamptz
);
create index if not exists local_ai_jobs_queue on public.local_ai_jobs(bridge_id, created_at);
-- No browser policies: the owner goes through the authenticated API only.
do $$ declare t text; begin
  foreach t in array array['local_ai_bridges','local_ai_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.local_ai_relay(p_action text, p_user uuid, p_hash text, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare b public.local_ai_bridges; j public.local_ai_jobs; online boolean;
begin
  if p_action in ('poll','complete') then
    if p_hash is null or p_user is not null then raise exception 'Invalid desktop credential.' using errcode='42501'; end if;
    select * into b from public.local_ai_bridges where key_hash = p_hash for update;
    if b.id is null then raise exception 'Invalid desktop credential.' using errcode='42501'; end if;
  elsif p_action in ('status','pair','revoke','enqueue','result','cancel') then
    if p_user is null or p_hash is not null then raise exception 'A user session is required.' using errcode='42501'; end if;
    select * into b from public.local_ai_bridges where user_id = p_user for update;
  else raise exception 'Unknown desktop model action.' using errcode='22023'; end if;

  if b.id is not null then
    -- Expire and scrub abandoned work; nothing keeps a meal photo past its deadline.
    update public.local_ai_jobs set status='expired', input=null, completed_at=now()
      where bridge_id=b.id and status in ('queued','running') and expires_at <= now();
    delete from public.local_ai_jobs where bridge_id=b.id and created_at < now()-interval '10 minutes';
  end if;
  online := coalesce(b.id is not null and b.key_hash is not null and b.ready and b.last_seen > now()-interval '15 seconds', false);

  if p_action='status' then
    return jsonb_build_object('paired', coalesce(b.key_hash is not null, false), 'online', online,
      'ready', coalesce(b.ready, false), 'model', b.model, 'last_seen', b.last_seen);
  elsif p_action in ('pair','revoke') then
    if p_action='pair' and coalesce(p_body->>'key_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key hash.' using errcode='22023'; end if;
    if b.id is null then
      if p_action='revoke' then return jsonb_build_object('ok',true); end if;
      insert into public.local_ai_bridges(user_id) values (p_user) returning * into b;
    end if;
    update public.local_ai_bridges set key_hash=case when p_action='pair' then p_body->>'key_hash' else null end,
      ready=false, last_seen=null where id=b.id;
    delete from public.local_ai_jobs where bridge_id=b.id;
    return jsonb_build_object('ok',true);
  elsif p_action='enqueue' then
    -- Not an error: the caller uses Claude whenever the desktop can't take the meal.
    if not online then return jsonb_build_object('online',false); end if;
    if (select count(*) from public.local_ai_jobs where bridge_id=b.id and status in ('queued','running')) >= 2 then
      return jsonb_build_object('online',true,'busy',true); end if;
    if jsonb_typeof(p_body->'input') is distinct from 'object' or octet_length((p_body->'input')::text) > 900000 then
      raise exception 'Invalid meal input.' using errcode='22023'; end if;
    insert into public.local_ai_jobs(user_id,bridge_id,input) values (b.user_id,b.id,p_body->'input') returning * into j;
    return jsonb_build_object('online',true,'id',j.id,'expires_at',j.expires_at);
  elsif p_action in ('result','cancel') then
    if b.id is null then return jsonb_build_object('status','expired'); end if;
    select * into j from public.local_ai_jobs where id=(p_body->>'id')::uuid and bridge_id=b.id;
    if j.id is null then return jsonb_build_object('status','expired'); end if;
    if p_action='cancel' or j.status in ('done','failed','expired') then
      delete from public.local_ai_jobs where id=j.id; -- read once, then gone
    end if;
    return jsonb_build_object('status',case when p_action='cancel' then 'expired' else j.status end,
      'result',j.result,'error',j.error,'model',j.model);
  elsif p_action='poll' then
    update public.local_ai_bridges set last_seen=now(), ready=coalesce((p_body->>'ready')::boolean,false),
      model=left(nullif(p_body->>'model',''),100) where id=b.id;
    if coalesce((p_body->>'ready')::boolean,false)
       and not exists(select 1 from public.local_ai_jobs where bridge_id=b.id and status='running') then
      select * into j from public.local_ai_jobs where bridge_id=b.id and status='queued' order by created_at,id limit 1 for update skip locked;
      if j.id is not null then
        update public.local_ai_jobs set status='running', claimed_at=now(), input=null where id=j.id;
        return jsonb_build_object('job',jsonb_build_object('id',j.id,'input',j.input,'expires_at',j.expires_at));
      end if;
    end if;
    return jsonb_build_object('job',null);
  elsif p_action='complete' then
    select * into j from public.local_ai_jobs where id=(p_body->>'id')::uuid and bridge_id=b.id for update;
    if j.id is null or j.status <> 'running' then return jsonb_build_object('ok',true,'ignored',true); end if;
    if jsonb_typeof(p_body->'ok') is distinct from 'boolean'
       or ((p_body->>'ok')::boolean and (jsonb_typeof(p_body->'result') is distinct from 'object' or octet_length((p_body->'result')::text) > 32768)) then
      raise exception 'Invalid desktop result.' using errcode='22023'; end if;
    update public.local_ai_jobs set status=case when (p_body->>'ok')::boolean then 'done' else 'failed' end,
      result=case when (p_body->>'ok')::boolean then p_body->'result' else null end,
      error=left(p_body->>'error',240), model=left(nullif(p_body->>'model',''),100), completed_at=now() where id=j.id;
    update public.local_ai_bridges set last_seen=now() where id=b.id;
    return jsonb_build_object('ok',true);
  end if;
end $$;
revoke all on function public.local_ai_relay(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.local_ai_relay(text,uuid,text,jsonb) to service_role;


-- Named presets use the same validated queue and BLE bridge as manual changes.
alter table public.room_controllers
  add column if not exists preset_schedule_enabled boolean not null default false,
  add column if not exists preset_last_slot timestamp;

create or replace function public.room_apply_preset(p_user uuid, p_preset text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.room_controllers;
  step jsonb;
  steps jsonb[];
  targets jsonb;
  result jsonb;
  ids jsonb := '[]'::jsonb;
  queued_at timestamptz;
begin
  steps := case p_preset
    when 'day' then array['{"power":true}', '{"brightness":100}', '{"temperature":5000}', '{"color":"#ffffff"}']::jsonb[]
    when 'relax' then array['{"power":true}', '{"brightness":40}', '{"temperature":2700}', '{"color":"#ffbf80"}']::jsonb[]
    when 'party' then array['{"power":true}', '{"brightness":100}', '{"color":"#ff0000"}']::jsonb[]
    when 'night' then array['{"power":false}']::jsonb[]
    when 'work' then array['{"power":true}', '{"brightness":100}', '{"color":"#a020ff"}']::jsonb[]
  end;
  if steps is null then
    raise exception 'Choose a room preset.' using errcode = '22023';
  end if;

  select * into c from public.room_controllers where user_id = p_user for update;
  if not found then
    raise exception 'No room controller is linked to this account.' using errcode = '42501';
  end if;
  -- Allow the bridge a full command window for each step of a preset.
  -- All steps are inserted together or rolled back together by the caller.

  foreach step in array steps loop
    select jsonb_agg(d->'id' order by ordinal) into targets
    from jsonb_array_elements(c.devices) with ordinality as devices(d, ordinal)
    where case
      when step ? 'temperature' then d->>'cct' = 'true'
      when step ? 'color' and p_preset in ('day', 'relax') then d->>'cct' is distinct from 'true'
      else true
    end;
    if targets is null then continue; end if;

    result := public.room_relay('command', c.user_id, null, jsonb_build_object('targets', targets, 'patch', step));
    -- Relay timestamps use now(), so add a small offset to preserve the order inside this transaction.
    queued_at := coalesce(queued_at + interval '1 microsecond', clock_timestamp());
    update public.room_commands
    set created_at = queued_at, expires_at = expires_at + interval '90 seconds' * jsonb_array_length(ids)
    where id = (result->>'id')::uuid;
    ids := ids || jsonb_build_array(result->'id');
  end loop;

  if ids = '[]'::jsonb then
    raise exception 'No lights are configured for this preset.' using errcode = '22023';
  end if;
  return jsonb_build_object('ids', ids, 'status', 'queued');
end $$;
revoke all on function public.room_apply_preset(uuid, text) from public, anon, authenticated;
grant execute on function public.room_apply_preset(uuid, text) to service_role;

create or replace function public.room_run_preset_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  slot timestamp := date_trunc('minute', new.last_seen at time zone 'America/New_York');
  preset text;
begin
  if new.preset_last_slot is not null and new.preset_last_slot >= slot then return null; end if;

  preset := case slot::time
    when time '07:00' then 'day'
    when time '17:00' then 'work'
    when time '21:00' then 'party'
    when time '00:00' then 'night'
  end;
  if preset is null then return null; end if;

  -- Wait for any in-flight work within this minute. Never replay a missed slot.
  if exists (select 1 from public.room_commands where controller_id = new.id
      and status in ('queued', 'sending') and expires_at > now()) then return null; end if;

  perform public.room_apply_preset(new.user_id, preset);
  update public.room_controllers set preset_last_slot = slot where id = new.id;
  return null;
exception when others then
  -- A schedule failure must not interrupt the bridge's manual controls.
  raise warning 'Room preset schedule could not queue a command (%).', sqlstate;
  return null;
end $$;
revoke all on function public.room_run_preset_schedule() from public, anon, authenticated;
grant execute on function public.room_run_preset_schedule() to service_role;

drop trigger if exists room_run_preset_schedule on public.room_controllers;
create trigger room_run_preset_schedule after update of last_seen on public.room_controllers
for each row when (new.preset_schedule_enabled and new.key_hash is not null and new.last_seen is not null)
execute function public.room_run_preset_schedule();

-- Per-project To Do column. An existing board link stays available as the
-- default board in the picker until the owner selects a column.
alter table public.projects add column if not exists todo_column_name text;
create index if not exists projects_todo_column_idx
  on public.projects (todo_board_id, todo_column_name) where todo_column_name is not null;
create index if not exists tasks_board_column_idx on public.tasks (board_id, column_name);

create or replace function public.check_project_todo_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  board_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  if new.todo_board_id is null then
    new.todo_column_name := null;
  elsif new.todo_column_name is not null then
    select b.columns into board_columns from public.boards b
      where b.id = new.todo_board_id and b.user_id = new.user_id for share;
    if not found then
      raise exception 'Choose a To Do board you own.';
    end if;
    board_columns := case when jsonb_typeof(board_columns) = 'array' and board_columns <> '[]'::jsonb
      then board_columns else default_columns end;
    if not (board_columns ? new.todo_column_name) then
      raise exception 'That To Do column is no longer available. Choose another column.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_project_todo_column on public.projects;
create trigger check_project_todo_column
  before insert or update of todo_board_id, todo_column_name, user_id on public.projects
  for each row execute function public.check_project_todo_column();

-- Check cards entering a board. Older clients save column renames and same-board
-- card moves separately, so leave those edits to the client or the atomic RPC.
create or replace function public.check_task_todo_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  board_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  if new.board_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.board_id is not distinct from new.board_id and old.user_id is not distinct from new.user_id then
      return new;
    end if;
  end if;
  -- Board RLS already includes owners and accepted collaborators.
  select b.columns into board_columns from public.boards b
    where b.id = new.board_id for share;
  if not found then
    raise exception 'That To Do board is no longer available.';
  end if;
  board_columns := case when jsonb_typeof(board_columns) = 'array' and board_columns <> '[]'::jsonb
    then board_columns else default_columns end;
  if new.column_name is null or not (board_columns ? new.column_name) then
    raise exception 'That To Do column is no longer available. Refresh the board and try again.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_task_todo_column on public.tasks;
create trigger check_task_todo_column
  before insert or update of board_id, column_name, user_id on public.tasks
  for each row execute function public.check_task_todo_column();

create or replace function public.update_todo_columns(
  p_board_id uuid, p_expected jsonb, p_columns jsonb,
  p_previous_name text default null, p_target_name text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  select b.columns into current_columns from public.boards b
    where b.id = p_board_id and b.user_id = owner_id for update;
  if not found then
    raise exception 'This To Do board is no longer available.';
  end if;
  current_columns := case when jsonb_typeof(current_columns) = 'array' and current_columns <> '[]'::jsonb
    then current_columns else default_columns end;
  if current_columns is distinct from p_expected then
    raise exception 'The columns changed in another window. Try again with the refreshed board.';
  end if;
  if jsonb_typeof(p_columns) is distinct from 'array' then
    raise exception 'Enter at least one column.';
  end if;
  if jsonb_array_length(p_columns) = 0 or exists (
    select 1 from jsonb_array_elements(p_columns) as entries(value)
    group by value having count(*) > 1 or jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') = ''
  ) then
    raise exception 'Use unique, non-empty column names.';
  end if;
  if p_previous_name is null then
    if p_target_name is not null or not (p_columns @> current_columns) then
      raise exception 'Specify a destination when removing a To Do column.';
    end if;
  elsif p_target_name is null or not (current_columns ? p_previous_name)
    or p_columns ? p_previous_name or not (p_columns ? p_target_name)
    or not (p_columns @> (current_columns - p_previous_name)) then
    raise exception 'The source or destination column is invalid.';
  end if;

  update public.boards set columns = p_columns where id = p_board_id and user_id = owner_id;

  if p_previous_name is not null then
    update public.tasks set column_name = p_target_name
      where board_id = p_board_id and column_name = p_previous_name;
    update public.projects
      set todo_column_name = case when current_columns ? p_target_name then null else p_target_name end
      where todo_board_id = p_board_id and user_id = owner_id and todo_column_name = p_previous_name;
  end if;
end;
$$;

revoke all on function public.check_project_todo_column() from public, anon, authenticated;
revoke all on function public.check_task_todo_column() from public, anon, authenticated;
revoke all on function public.update_todo_columns(uuid, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.update_todo_columns(uuid, jsonb, jsonb, text, text) to authenticated;
