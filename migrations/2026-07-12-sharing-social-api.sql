-- ============================================================
-- Shared To-Do lists, Nutrition external API keys, water logs,
-- Nutrition friends + challenges.
-- Safe to run multiple times (all guarded / idempotent).
-- Run in: Supabase dashboard → SQL Editor → paste → Run.
-- (The same SQL is appended to supabase-schema.sql.)
-- ============================================================

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

-- ============================================
-- RLS for the new tables
-- ============================================
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
