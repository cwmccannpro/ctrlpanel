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
  updated_at timestamptz default now()
);

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
-- AGENTS
-- ============================================
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  webhook_url text,
  status text default 'stopped' check (status in ('running','stopped')),
  last_run timestamptz,
  created_at timestamptz default now()
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
    'transactions','holdings','portfolio_snapshots','dividends','agents'
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
end $$;

-- ============================================
-- Done. Enable Email auth under Authentication → Providers,
-- then register your first account in the app.
-- ============================================
