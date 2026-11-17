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
