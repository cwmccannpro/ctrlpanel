-- Private outbound-only Windows BLE relay. Provision real hardware separately.
create table if not exists public.room_controllers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade unique,
  name text not null default 'Windows desktop',
  key_hash text unique,
  devices jsonb not null default '[]'::jsonb,
  last_sent jsonb not null default '{}'::jsonb,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.room_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  controller_id uuid not null references public.room_controllers(id) on delete cascade,
  targets jsonb not null,
  patch jsonb not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','partial','failed','expired','cancelled')),
  results jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  completed_at timestamptz
);
create index if not exists room_commands_queue on public.room_commands(controller_id, created_at);
-- No browser policies: even the owner uses the authenticated API. Controller
-- enrollment/configuration is server-only, so other accounts cannot claim it.
do $$ declare t text; begin
  foreach t in array array['room_controllers','room_commands'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.room_relay(p_action text, p_user uuid, p_hash text, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.room_controllers; cmd public.room_commands; result jsonb; item jsonb;
  successes integer := 0; recent jsonb; key_count integer;
begin
  if p_action in ('poll','ack') then
    if p_hash is null or p_user is not null then raise exception 'Invalid controller credential.' using errcode='42501'; end if;
    select * into c from public.room_controllers where key_hash = p_hash for update;
  elsif p_action in ('status','pair','revoke','command') then
    if p_user is null or p_hash is not null then raise exception 'A user session is required.' using errcode='42501'; end if;
    select * into c from public.room_controllers where user_id = p_user for update;
  else raise exception 'Unknown room action.' using errcode='22023'; end if;
  if c.id is null then raise exception 'No room controller is linked to this account.' using errcode='42501'; end if;

  update public.room_commands set status='expired', completed_at=now()
    where controller_id=c.id and status in ('queued','sending') and expires_at <= now();


  if p_action='status' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb) into recent
      from (select id,targets,patch,status,results,created_at,expires_at from public.room_commands
            where controller_id=c.id order by created_at desc limit 12) q;
    return jsonb_build_object('controller',jsonb_build_object('name',c.name,'paired',c.key_hash is not null,
      'devices',c.devices,'last_sent',c.last_sent,'last_seen',c.last_seen),'commands',recent);
  elsif p_action in ('pair','revoke') then
    if p_action='pair' and coalesce(p_body->>'key_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key hash.' using errcode='22023'; end if;
    update public.room_controllers set key_hash=case when p_action='pair' then p_body->>'key_hash' else null end,
      last_seen=null where id=c.id;
    update public.room_commands set status='cancelled',completed_at=now() where controller_id=c.id and status in ('queued','sending');
    return jsonb_build_object('ok',true);
  elsif p_action='command' then
    if c.key_hash is null or c.last_seen is null or c.last_seen < now()-interval '30 seconds' then
      raise exception 'Desktop is offline. Wake it and start the room bridge.' using errcode='55000'; end if;
    if jsonb_typeof(p_body->'targets') is distinct from 'array' or jsonb_array_length(p_body->'targets') not between 1 and 16
       or jsonb_typeof(p_body->'patch') is distinct from 'object' then raise exception 'Invalid light command.' using errcode='22023'; end if;
    select count(*) into key_count from jsonb_object_keys(p_body->'patch');
    if key_count != 1 or not (p_body->'patch' ?| array['power','brightness','color','temperature']) then
      raise exception 'Invalid light setting.' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_body->'targets') loop
      if not exists (select 1 from jsonb_array_elements(c.devices) d where d->>'id'=item#>>'{}'
        and (not (p_body->'patch' ? 'temperature') or d->>'cct'='true')) then
        raise exception 'Light is not configured for this setting.' using errcode='22023'; end if;
    end loop;
    if (select count(*) from public.room_commands where controller_id=c.id and created_at>now()-interval '1 minute') >= 60 then
      raise exception 'Too many changes. Wait a moment.' using errcode='54000'; end if;
    if (select count(*) from public.room_commands where controller_id=c.id and status in ('queued','sending')) >= 8 then
      raise exception 'The desktop is still sending changes. Wait a moment.' using errcode='54000'; end if;
    insert into public.room_commands(user_id,controller_id,targets,patch) values(c.user_id,c.id,p_body->'targets',p_body->'patch') returning * into cmd;
    return jsonb_build_object('id',cmd.id,'status',cmd.status);
  elsif p_action='poll' then
    update public.room_controllers set last_seen=now() where id=c.id;
    if not exists(select 1 from public.room_commands where controller_id=c.id and status='sending') then
      select * into cmd from public.room_commands where controller_id=c.id and status='queued' order by created_at,id limit 1 for update;
      if cmd.id is not null then update public.room_commands set status='sending' where id=cmd.id; end if;
    end if;
    return jsonb_build_object('devices',c.devices,'last_sent',c.last_sent,'command',case when cmd.id is null then null else
      jsonb_build_object('id',cmd.id,'targets',cmd.targets,'patch',cmd.patch,'expires_at',cmd.expires_at) end);
  elsif p_action='ack' then
    select * into cmd from public.room_commands where id=(p_body->>'id')::uuid and controller_id=c.id for update;
    if cmd.id is null then raise exception 'Unknown room command.' using errcode='42501'; end if;
    if cmd.status in ('sent','partial','failed') then return jsonb_build_object('ok',true); end if;
    if cmd.status != 'sending' then raise exception 'Command expired or was cancelled.' using errcode='55000'; end if;
    if jsonb_typeof(p_body->'results') is distinct from 'array' or jsonb_array_length(p_body->'results') != jsonb_array_length(cmd.targets) then
      raise exception 'A result is required for every light.' using errcode='22023'; end if;
    if (select count(distinct r->>'id') from jsonb_array_elements(p_body->'results') r) != jsonb_array_length(cmd.targets) then
      raise exception 'Duplicate light receipt.' using errcode='22023'; end if;
    for result in select value from jsonb_array_elements(p_body->'results') loop
      if not (cmd.targets ? (result->>'id')) or jsonb_typeof(result->'ok') is distinct from 'boolean' then
        raise exception 'Invalid light receipt.' using errcode='22023'; end if;
      if (result->>'ok')::boolean then
        successes := successes+1;
        c.last_sent := jsonb_set(c.last_sent,array[result->>'id'],coalesce(c.last_sent->(result->>'id'),'{}'::jsonb)
          || cmd.patch || jsonb_build_object('sent_at',now())
          || case when cmd.patch ? 'color' then '{"mode":"color"}'::jsonb when cmd.patch ? 'temperature' then '{"mode":"white"}'::jsonb else '{}'::jsonb end);
      end if;
    end loop;
    update public.room_controllers set last_seen=now(),last_sent=c.last_sent where id=c.id;
    update public.room_commands set results=p_body->'results',completed_at=now(),
      status=case when successes=0 then 'failed' when successes=jsonb_array_length(cmd.targets) then 'sent' else 'partial' end where id=cmd.id;
    return jsonb_build_object('ok',true);
  end if;
end $$;
revoke all on function public.room_relay(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.room_relay(text,uuid,text,jsonb) to service_role;
