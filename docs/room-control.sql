-- Room Control addition only. Safe to run on the existing CTRLpanel database.
-- Service role only: all browser reads and writes pass through authenticated
-- /api/room endpoints, which constrain every query to the signed-in owner.
create table if not exists public.room_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  key_hash text not null unique,
  snapshot jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.room_commands (
  id uuid primary key,
  connection_id uuid not null references public.room_connections(id) on delete cascade,
  method text not null check (method in ('POST','PUT','DELETE')),
  path text not null,
  body jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed','expired','unknown')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  started_at timestamptz
);
create index if not exists room_commands_queue on public.room_commands(connection_id, status, created_at);
do $$ declare t text; begin
  foreach t in array array['room_connections','room_commands'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Claim before physical I/O. A lost response never replays an alarm or scene.
-- Crashed / ambiguous actions become "unknown"; the UI asks the user to check.
create or replace function public.claim_room_command(bridge_id uuid, bridge_hash text, bridge_busy boolean default false)
returns setof public.room_commands
language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from room_connections where id = bridge_id and key_hash = bridge_hash for update;
  if not found then return; end if;
  delete from room_commands where connection_id = bridge_id and created_at < now() - interval '7 days';
  update room_commands set status = 'expired'
    where connection_id = bridge_id and status = 'pending' and expires_at < now();
  update room_commands set status = 'unknown', error = 'Controller did not confirm completion. Check room activity before retrying.'
    where connection_id = bridge_id and status = 'running' and started_at < now() - interval '3 minutes';
  return query update room_commands set status = 'running', started_at = now()
    where id = (select id from room_commands where connection_id = bridge_id and status = 'pending'
      and (path = '/alarm/stop' or (not bridge_busy and not exists
        (select 1 from room_commands active where active.connection_id = bridge_id and active.status = 'running')))
      and expires_at > now() order by (path = '/alarm/stop') desc, created_at limit 1 for update skip locked)
    returning *;
end $$;
revoke all on function public.claim_room_command(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_room_command(uuid, text, boolean) to service_role;
