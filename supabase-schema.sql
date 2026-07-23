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
  updated_at timestamptz default now()
);

-- Life View / dashboard widget prefs (safe to re-run on existing installs)
alter table user_settings add column if not exists birthdate date;
alter table user_settings add column if not exists life_expectancy integer default 90;
alter table user_settings add column if not exists show_life_widget boolean default false;
alter table user_settings add column if not exists dashboard_widgets jsonb;

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
-- SHARED TO-DO LISTS
-- One row per invite. Pending until the recipient opens the tokenized
-- accept link (email via Resend) and the backend marks it accepted.
-- board_name / inviter_email are denormalized so the recipient can see
-- who invited them before they gain access to the board row itself.
-- ============================================
create table if not exists board_shares (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_name text,
  inviter_email text,
  invitee_email text not null,
  invitee_user_id uuid references auth.users(id) on delete cascade,
  token text unique not null,
  status text default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz default now(),
  accepted_at timestamptz
);
create index if not exists board_shares_board on board_shares(board_id);
create index if not exists board_shares_invitee on board_shares(invitee_user_id);

-- Security-definer helpers so board/task policies can consult board_shares
-- (and vice versa) without RLS recursion.
create or replace function public.can_access_board(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from boards b where b.id = bid and b.user_id = auth.uid())
      or exists (
        select 1 from board_shares s
        where s.board_id = bid and s.status = 'accepted' and s.invitee_user_id = auth.uid()
      );
$$;

create or replace function public.is_board_owner(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from boards b where b.id = bid and b.user_id = auth.uid());
$$;

alter table board_shares enable row level security;

-- Parties to a share (board members, the invited email) may read it.
drop policy if exists "share parties read" on board_shares;
create policy "share parties read" on board_shares for select using (
  invitee_user_id = auth.uid()
  or invitee_email = (auth.jwt() ->> 'email')
  or can_access_board(board_id)
);
-- Owner revokes; recipient declines / leaves. Inserts + accepts go through
-- the backend (service role), which also sends the Resend emails.
drop policy if exists "share parties delete" on board_shares;
create policy "share parties delete" on board_shares for delete using (
  invitee_user_id = auth.uid()
  or invitee_email = (auth.jwt() ->> 'email')
  or is_board_owner(board_id)
);

-- Collaborators get full read/write on shared boards + their tasks
-- (additional permissive policies OR'ed with the existing "own rows").
drop policy if exists "shared boards read" on boards;
create policy "shared boards read" on boards for select using (can_access_board(id));
drop policy if exists "shared boards update" on boards;
create policy "shared boards update" on boards for update
  using (can_access_board(id)) with check (can_access_board(id));

drop policy if exists "shared board tasks" on tasks;
create policy "shared board tasks" on tasks for all
  using (board_id is not null and can_access_board(board_id))
  with check (board_id is not null and can_access_board(board_id));

-- Live sync for collaborators (Realtime postgres_changes, RLS-filtered).
do $$ begin
  alter publication supabase_realtime add table tasks;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table boards;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table board_shares;
exception when others then null; end $$;

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

-- ============================================
-- NUTRITION: friends + challenges
-- Rows are written AND read via the backend (service role) so users only
-- ever see friends' aggregate metrics — never raw logs. RLS is enabled
-- with no client policies (same pattern as google_tokens).
-- ============================================
create table if not exists nutrition_friends (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  inviter_email text,
  invitee_email text not null,
  invitee_user_id uuid references auth.users(id) on delete cascade,
  token text unique not null,
  status text default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz default now(),
  accepted_at timestamptz
);
create index if not exists nutrition_friends_inviter on nutrition_friends(inviter_id);
create index if not exists nutrition_friends_invitee on nutrition_friends(invitee_user_id);

create table if not exists nutrition_challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  metric text not null check (metric in ('calorie_goal_days','protein_goal_days','water_total','log_days')),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz default now()
);

create table if not exists nutrition_challenge_members (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references nutrition_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text default 'invited' check (status in ('invited','accepted','declined')),
  created_at timestamptz default now(),
  unique (challenge_id, user_id)
);

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

  -- Service-role-only tables (no client policies)
  foreach t in array array['nutrition_friends','nutrition_challenges','nutrition_challenge_members'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ============================================
-- REPORTS: inbound PDF reports (replaces the old Agents + Email Triage
-- features, whose tables are dropped below).
--
-- A "report source" is a named inbound channel with its own token. External
-- tools (e.g. a Claude routine doing email triage) POST a PDF to
--   /api/reports/ingest   (Authorization: Bearer ctpr_… or X-API-Key)
-- and it lands as a `reports` row + a PDF in the private `reports` storage
-- bucket. Only the SHA-256 hash of a token is stored; the plaintext is shown
-- once when the source is created in the app.
-- ============================================

-- Retire the removed features. Safe to re-run; drops data for those tables.
drop table if exists triage_items cascade;
drop table if exists triage_runs cascade;
drop table if exists gmail_accounts cascade;
drop table if exists agent_runs cascade;
drop table if exists agents cascade;

create table if not exists report_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text,                   -- first chars of the token, for display
  key_hash text unique not null,     -- SHA-256 of the plaintext token
  last_received_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists report_sources_user on report_sources(user_id, created_at desc);

-- One row per received PDF. Written by the backend (service role, user_id set
-- explicitly from the token's source); read + deleted by the owner's client
-- under the standard "own rows" policy. The PDF bytes live in Storage; only
-- the object path is stored here.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id uuid references report_sources(id) on delete cascade,
  title text not null,
  file_path text not null,           -- storage object path: {user_id}/{source_id}/{uuid}.pdf
  file_size bigint,
  received_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists reports_user_date on reports(user_id, received_at desc);
create index if not exists reports_source on reports(source_id);

-- RLS: both tables are standard "own rows".
do $$
declare
  t text;
begin
  foreach t in array array['report_sources','reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

-- Private storage bucket for the PDFs. The backend (service role) writes them;
-- the owner reads/deletes their own via signed URLs, gated by the policies
-- below (folder 1 of the object path is the owner's user_id).
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

do $$
begin
  drop policy if exists "reports read own" on storage.objects;
  create policy "reports read own" on storage.objects for select to authenticated
    using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

  drop policy if exists "reports delete own" on storage.objects;
  create policy "reports delete own" on storage.objects for delete to authenticated
    using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
end $$;

-- ============================================
-- Done. Enable Email auth under Authentication → Providers,
-- then register your first account in the app.
-- ============================================
