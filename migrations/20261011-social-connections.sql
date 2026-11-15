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
