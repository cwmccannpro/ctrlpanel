-- Project-aware Knowledge API writes and legacy project-note consolidation.
-- Additive and safe to re-run. Existing projects.notes / notes_list data is
-- retained after copying so rollback never destroys the original content.

-- Claim a browser-created note (which has no external key) for a vault.
create or replace function public.claim_context_note(
  p_user uuid,
  p_note uuid,
  p_key text,
  p_expected timestamptz
)
returns knowledge_notes
language plpgsql
security invoker
set search_path = public
as $$
declare existing knowledge_notes; result knowledge_notes;
begin
  select * into existing from knowledge_notes where id = p_note and user_id = p_user for update;
  if not found then
    raise exception 'Note is unavailable.' using errcode = '42501';
  end if;
  if existing.external_key = p_key then
    return existing;
  end if;
  if existing.external_key is not null or p_expected is null or existing.updated_at <> p_expected then
    raise exception 'Note changed or is already linked.' using errcode = '40001';
  end if;
  update knowledge_notes set external_key = p_key where id = p_note returning * into result;
  return result;
end $$;
revoke all on function public.claim_context_note(uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_context_note(uuid,uuid,text,timestamptz) to service_role;


create or replace function public.save_context_note_v2(
  p_user uuid,
  p_key text,
  p_title text,
  p_folder text,
  p_content text,
  p_project uuid,
  p_set_project boolean,
  p_expected timestamptz
)
returns knowledge_notes
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing knowledge_notes;
  result knowledge_notes;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_key, 0));

  if p_set_project and p_project is not null and not exists (
    select 1 from projects where id = p_project and user_id = p_user
  ) then
    raise exception 'Project is unavailable.' using errcode = '42501';
  end if;

  select * into existing
  from knowledge_notes
  where user_id = p_user and external_key = p_key
  for update;

  if found then
    if existing.title = p_title
      and existing.folder = p_folder
      and existing.content = p_content
      and (not p_set_project or existing.project_id is not distinct from p_project)
    then
      return existing;
    end if;
    if p_expected is null or existing.updated_at <> p_expected then
      raise exception 'Context changed; read the latest note and merge before saving.' using errcode = '40001';
    end if;
    update knowledge_notes
    set title = p_title,
        folder = p_folder,
        content = p_content,
        project_id = case when p_set_project then p_project else project_id end,
        aliases = case
          when title <> p_title or folder <> p_folder then
            array_append(array_append(aliases, title), case when folder = '' then title else folder || '/' || title end)
          else aliases
        end
    where id = existing.id
    returning * into result;
  else
    if p_expected is not null then
      raise exception 'Note no longer exists; read before saving.' using errcode = '40001';
    end if;
    insert into knowledge_notes (user_id, external_key, title, folder, content, project_id)
    values (p_user, p_key, p_title, p_folder, p_content, case when p_set_project then p_project else null end)
    returning * into result;
  end if;
  return result;
end $$;

revoke all on function public.save_context_note_v2(uuid,text,text,text,text,uuid,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.save_context_note_v2(uuid,text,text,text,text,uuid,boolean,timestamptz) to service_role;

-- Copy the structured legacy project notes first. A deterministic external key
-- makes the migration idempotent even when the full schema is re-run.
insert into knowledge_notes (
  user_id, project_id, external_key, title, content, folder, tags, pinned, created_at, updated_at
)
select
  p.user_id,
  p.id,
  'legacy-project-note/' || p.id::text || '/' || md5(coalesce(item->>'id','') || ':' || ordinality::text || ':' || coalesce(item->>'title','')),
  coalesce(nullif(btrim(item->>'title'), ''), 'Project note'),
  coalesce(item->>'content', ''),
  'Projects/' || p.name,
  array['legacy-project-note']::text[],
  case when lower(coalesce(item->>'pinned', 'false')) = 'true' then true else false end,
  p.created_at,
  p.created_at
from projects p
cross join lateral jsonb_array_elements(coalesce(p.notes_list, '[]'::jsonb)) with ordinality as legacy(item, ordinality)
on conflict do nothing;

-- The original single notes blob is only the source when notes_list is empty,
-- matching the old UI's fallback behavior.
insert into knowledge_notes (
  user_id, project_id, external_key, title, content, folder, tags, pinned, created_at, updated_at
)
select
  p.user_id,
  p.id,
  'legacy-project-note/' || p.id::text || '/single',
  'Notes',
  p.notes,
  'Projects/' || p.name,
  array['legacy-project-note']::text[],
  false,
  p.created_at,
  p.created_at
from projects p
where coalesce(jsonb_array_length(coalesce(p.notes_list, '[]'::jsonb)), 0) = 0
  and nullif(btrim(p.notes), '') is not null
on conflict do nothing;
