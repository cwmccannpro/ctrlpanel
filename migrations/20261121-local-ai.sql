-- Desktop model relay for meal estimates. The owner's Windows desktop polls
-- outbound over HTTPS with a ctla_ key; CTRLpanel hands it one meal at a time
-- while it reports a ready local model, and falls back to Claude otherwise.
create table if not exists public.local_ai_bridges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade unique,
  name text not null default 'Windows desktop',
  key_hash text unique,
  model text,
  ready boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.local_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id uuid not null references public.local_ai_bridges(id) on delete cascade,
  input jsonb, -- the photo/description; cleared the moment the desktop claims it
  status text not null default 'queued' check (status in ('queued','running','done','failed','expired')),
  result jsonb,
  error text,
  model text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  claimed_at timestamptz,
  completed_at timestamptz
);
create index if not exists local_ai_jobs_queue on public.local_ai_jobs(bridge_id, created_at);
-- No browser policies: the owner goes through the authenticated API only.
do $$ declare t text; begin
  foreach t in array array['local_ai_bridges','local_ai_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.local_ai_relay(p_action text, p_user uuid, p_hash text, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare b public.local_ai_bridges; j public.local_ai_jobs; online boolean;
begin
  if p_action in ('poll','complete') then
    if p_hash is null or p_user is not null then raise exception 'Invalid desktop credential.' using errcode='42501'; end if;
    select * into b from public.local_ai_bridges where key_hash = p_hash for update;
    if b.id is null then raise exception 'Invalid desktop credential.' using errcode='42501'; end if;
  elsif p_action in ('status','pair','revoke','enqueue','result','cancel') then
    if p_user is null or p_hash is not null then raise exception 'A user session is required.' using errcode='42501'; end if;
    select * into b from public.local_ai_bridges where user_id = p_user for update;
  else raise exception 'Unknown desktop model action.' using errcode='22023'; end if;

  if b.id is not null then
    -- Expire and scrub abandoned work; nothing keeps a meal photo past its deadline.
    update public.local_ai_jobs set status='expired', input=null, completed_at=now()
      where bridge_id=b.id and status in ('queued','running') and expires_at <= now();
    delete from public.local_ai_jobs where bridge_id=b.id and created_at < now()-interval '10 minutes';
  end if;
  online := coalesce(b.id is not null and b.key_hash is not null and b.ready and b.last_seen > now()-interval '15 seconds', false);

  if p_action='status' then
    return jsonb_build_object('paired', coalesce(b.key_hash is not null, false), 'online', online,
      'ready', coalesce(b.ready, false), 'model', b.model, 'last_seen', b.last_seen);
  elsif p_action in ('pair','revoke') then
    if p_action='pair' and coalesce(p_body->>'key_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key hash.' using errcode='22023'; end if;
    if b.id is null then
      if p_action='revoke' then return jsonb_build_object('ok',true); end if;
      insert into public.local_ai_bridges(user_id) values (p_user) returning * into b;
    end if;
    update public.local_ai_bridges set key_hash=case when p_action='pair' then p_body->>'key_hash' else null end,
      ready=false, last_seen=null where id=b.id;
    delete from public.local_ai_jobs where bridge_id=b.id;
    return jsonb_build_object('ok',true);
  elsif p_action='enqueue' then
    -- Not an error: the caller uses Claude whenever the desktop can't take the meal.
    if not online then return jsonb_build_object('online',false); end if;
    if (select count(*) from public.local_ai_jobs where bridge_id=b.id and status in ('queued','running')) >= 2 then
      return jsonb_build_object('online',true,'busy',true); end if;
    if jsonb_typeof(p_body->'input') is distinct from 'object' or octet_length((p_body->'input')::text) > 900000 then
      raise exception 'Invalid meal input.' using errcode='22023'; end if;
    insert into public.local_ai_jobs(user_id,bridge_id,input) values (b.user_id,b.id,p_body->'input') returning * into j;
    return jsonb_build_object('online',true,'id',j.id,'expires_at',j.expires_at);
  elsif p_action in ('result','cancel') then
    if b.id is null then return jsonb_build_object('status','expired'); end if;
    select * into j from public.local_ai_jobs where id=(p_body->>'id')::uuid and bridge_id=b.id;
    if j.id is null then return jsonb_build_object('status','expired'); end if;
    if p_action='cancel' or j.status in ('done','failed','expired') then
      delete from public.local_ai_jobs where id=j.id; -- read once, then gone
    end if;
    return jsonb_build_object('status',case when p_action='cancel' then 'expired' else j.status end,
      'result',j.result,'error',j.error,'model',j.model);
  elsif p_action='poll' then
    update public.local_ai_bridges set last_seen=now(), ready=coalesce((p_body->>'ready')::boolean,false),
      model=left(nullif(p_body->>'model',''),100) where id=b.id;
    if coalesce((p_body->>'ready')::boolean,false)
       and not exists(select 1 from public.local_ai_jobs where bridge_id=b.id and status='running') then
      select * into j from public.local_ai_jobs where bridge_id=b.id and status='queued' order by created_at,id limit 1 for update skip locked;
      if j.id is not null then
        update public.local_ai_jobs set status='running', claimed_at=now(), input=null where id=j.id;
        return jsonb_build_object('job',jsonb_build_object('id',j.id,'input',j.input,'expires_at',j.expires_at));
      end if;
    end if;
    return jsonb_build_object('job',null);
  elsif p_action='complete' then
    select * into j from public.local_ai_jobs where id=(p_body->>'id')::uuid and bridge_id=b.id for update;
    if j.id is null or j.status <> 'running' then return jsonb_build_object('ok',true,'ignored',true); end if;
    if jsonb_typeof(p_body->'ok') is distinct from 'boolean'
       or ((p_body->>'ok')::boolean and (jsonb_typeof(p_body->'result') is distinct from 'object' or octet_length((p_body->'result')::text) > 32768)) then
      raise exception 'Invalid desktop result.' using errcode='22023'; end if;
    update public.local_ai_jobs set status=case when (p_body->>'ok')::boolean then 'done' else 'failed' end,
      result=case when (p_body->>'ok')::boolean then p_body->'result' else null end,
      error=left(p_body->>'error',240), model=left(nullif(p_body->>'model',''),100), completed_at=now() where id=j.id;
    update public.local_ai_bridges set last_seen=now() where id=b.id;
    return jsonb_build_object('ok',true);
  end if;
end $$;
revoke all on function public.local_ai_relay(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.local_ai_relay(text,uuid,text,jsonb) to service_role;
