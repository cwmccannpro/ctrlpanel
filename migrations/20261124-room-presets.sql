-- Named presets use the same validated queue and BLE bridge as manual changes.
alter table public.room_controllers
  add column if not exists preset_schedule_enabled boolean not null default false,
  add column if not exists preset_last_slot timestamp;

create or replace function public.room_apply_preset(p_user uuid, p_preset text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.room_controllers;
  step jsonb;
  steps jsonb[];
  targets jsonb;
  result jsonb;
  ids jsonb := '[]'::jsonb;
  queued_at timestamptz;
begin
  steps := case p_preset
    when 'day' then array['{"power":true}', '{"brightness":100}', '{"temperature":5000}', '{"color":"#ffffff"}']::jsonb[]
    when 'relax' then array['{"power":true}', '{"brightness":40}', '{"temperature":2700}', '{"color":"#ffbf80"}']::jsonb[]
    when 'party' then array['{"power":true}', '{"brightness":100}', '{"color":"#ff0000"}']::jsonb[]
    when 'night' then array['{"power":false}']::jsonb[]
    when 'work' then array['{"power":true}', '{"brightness":100}', '{"color":"#a020ff"}']::jsonb[]
  end;
  if steps is null then
    raise exception 'Choose a room preset.' using errcode = '22023';
  end if;

  select * into c from public.room_controllers where user_id = p_user for update;
  if not found then
    raise exception 'No room controller is linked to this account.' using errcode = '42501';
  end if;
  -- Allow the bridge a full command window for each step of a preset.
  -- All steps are inserted together or rolled back together by the caller.

  foreach step in array steps loop
    select jsonb_agg(d->'id' order by ordinal) into targets
    from jsonb_array_elements(c.devices) with ordinality as devices(d, ordinal)
    where case
      when step ? 'temperature' then d->>'cct' = 'true'
      when step ? 'color' and p_preset in ('day', 'relax') then d->>'cct' is distinct from 'true'
      else true
    end;
    if targets is null then continue; end if;

    result := public.room_relay('command', c.user_id, null, jsonb_build_object('targets', targets, 'patch', step));
    -- Relay timestamps use now(), so add a small offset to preserve the order inside this transaction.
    queued_at := coalesce(queued_at + interval '1 microsecond', clock_timestamp());
    update public.room_commands
    set created_at = queued_at, expires_at = expires_at + interval '90 seconds' * jsonb_array_length(ids)
    where id = (result->>'id')::uuid;
    ids := ids || jsonb_build_array(result->'id');
  end loop;

  if ids = '[]'::jsonb then
    raise exception 'No lights are configured for this preset.' using errcode = '22023';
  end if;
  return jsonb_build_object('ids', ids, 'status', 'queued');
end $$;
revoke all on function public.room_apply_preset(uuid, text) from public, anon, authenticated;
grant execute on function public.room_apply_preset(uuid, text) to service_role;

create or replace function public.room_run_preset_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  slot timestamp := date_trunc('minute', new.last_seen at time zone 'America/New_York');
  preset text;
begin
  if new.preset_last_slot is not null and new.preset_last_slot >= slot then return null; end if;

  preset := case slot::time
    when time '07:00' then 'day'
    when time '17:00' then 'work'
    when time '21:00' then 'party'
    when time '00:00' then 'night'
  end;
  if preset is null then return null; end if;

  -- Wait for any in-flight work within this minute. Never replay a missed slot.
  if exists (select 1 from public.room_commands where controller_id = new.id
      and status in ('queued', 'sending') and expires_at > now()) then return null; end if;

  perform public.room_apply_preset(new.user_id, preset);
  update public.room_controllers set preset_last_slot = slot where id = new.id;
  return null;
exception when others then
  -- A schedule failure must not interrupt the bridge's manual controls.
  raise warning 'Room preset schedule could not queue a command (%).', sqlstate;
  return null;
end $$;
revoke all on function public.room_run_preset_schedule() from public, anon, authenticated;
grant execute on function public.room_run_preset_schedule() to service_role;

drop trigger if exists room_run_preset_schedule on public.room_controllers;
create trigger room_run_preset_schedule after update of last_seen on public.room_controllers
for each row when (new.preset_schedule_enabled and new.key_hash is not null and new.last_seen is not null)
execute function public.room_run_preset_schedule();
