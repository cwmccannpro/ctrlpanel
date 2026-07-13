-- ============================================================
-- Email Triage (multi-account Gmail): connected accounts,
-- triage runs + items (the daily brief).
-- Safe to run multiple times (all guarded / idempotent).
-- Run in: Supabase dashboard → SQL Editor → paste → Run.
-- (The same SQL is appended to supabase-schema.sql.)
-- ============================================================

-- ============================================
-- GMAIL ACCOUNTS (backend-managed, never client-readable)
-- One row per connected Gmail account, per user, labeled with a short
-- user-chosen alias (e.g. "viridian", "personal"). Holds OAuth tokens, so
-- RLS is enabled with NO policies — only the backend service_role key may
-- read/write (same pattern as google_tokens). The browser sees accounts
-- only through /api/gmail/status, which returns alias + email, never tokens.
-- ============================================
create table if not exists gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias text not null,
  email text,
  access_token text,
  refresh_token text,
  scope text,
  token_type text,
  expiry_date bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, alias)
);
create index if not exists gmail_accounts_user on gmail_accounts(user_id);

-- ============================================
-- TRIAGE RUNS + ITEMS
-- One triage_runs row per scan (scheduled or "Run now"); one triage_items
-- row per categorized email, denormalized with account alias/email so the
-- brief renders without joining gmail_accounts (which the client can't read).
-- Written by the backend (service role, user_id set explicitly); read by the
-- user's own client under the standard "own rows" policy.
-- ============================================
create table if not exists triage_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_at timestamptz default now(),
  source text default 'manual' check (source in ('manual','scheduled')),
  status text default 'running' check (status in ('running','complete','error')),
  accounts_scanned int default 0,
  emails_scanned int default 0,
  error text
);
create index if not exists triage_runs_user_date on triage_runs(user_id, run_at desc);

create table if not exists triage_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_id uuid not null references triage_runs(id) on delete cascade,
  account_id uuid references gmail_accounts(id) on delete set null,
  account_alias text,
  account_email text,
  gmail_message_id text,
  gmail_thread_id text,
  from_name text,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz,
  category text check (category in ('needs_reply','client_lead','payments','ignore')),
  summary text,
  suggested_reply text,
  draft_id text,                     -- set when the user approves → Gmail draft
  draft_created_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists triage_items_user_run on triage_items(user_id, run_id);

-- RLS for the new tables
do $$
declare
  t text;
begin
  -- Standard per-user tables (client-readable briefs)
  foreach t in array array['triage_runs','triage_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;

  -- Service-role-only table (holds OAuth tokens — no client policies)
  execute 'alter table gmail_accounts enable row level security';
end $$;
