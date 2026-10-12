-- Socials → Instagram account analytics.
-- One row per connected Instagram professional (Business/Creator) account,
-- holding the 60-day access token + cached counts. Same pattern as
-- youtube_channels: RLS enabled with NO policy, so only the service-role
-- backend can read it (the browser never sees tokens).
-- Safe to re-run.

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
