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
