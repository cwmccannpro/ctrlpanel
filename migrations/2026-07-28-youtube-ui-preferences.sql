-- Deployment companion for the 2026-07-28 YouTube integration and persisted
-- UI preferences. supabase-schema.sql remains the authoritative full schema.

alter table user_settings
  add column if not exists ui_preferences jsonb default '{}'::jsonb;

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

create table if not exists youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  title text,
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
alter table youtube_channels enable row level security;
