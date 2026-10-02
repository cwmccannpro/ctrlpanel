-- Additive migration for the existing original CTRLpanel database.
-- Extracted from supabase-schema.sql, the authoritative schema.
begin;
-- KNOWLEDGE BASE: private Markdown context, linked into per-project graphs.
create table if not exists knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  content text not null default '',
  folder text not null default '',
  tags text[] not null default '{}',
  aliases text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_notes_user_updated on knowledge_notes(user_id, updated_at desc);
create index if not exists knowledge_notes_project on knowledge_notes(project_id);
do $$
declare t text;
begin
  foreach t in array array['knowledge_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
-- Even a guessed project UUID cannot attach private context to another owner.
drop policy if exists "knowledge own project" on knowledge_notes;
create policy "knowledge own project" on knowledge_notes as restrictive for all
  using (auth.uid() = user_id)
  with check (project_id is null or exists (
    select 1 from projects p where p.id = project_id and p.user_id = auth.uid()
  ));

-- CONTEXT SYNC: revocable external clients and stable note identities.
alter table knowledge_notes add column if not exists external_key text;
create unique index if not exists knowledge_external_key on knowledge_notes(user_id, external_key) where external_key is not null;
create table if not exists knowledge_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text unique not null,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['knowledge_api_keys'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
-- Every writer gets a database-assigned version, including browser edits.
create or replace function public.knowledge_stamp() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists knowledge_stamp on knowledge_notes;
create trigger knowledge_stamp before update on knowledge_notes for each row execute function public.knowledge_stamp();

-- One note per stable external key. A stale writer must read and merge first.
create or replace function public.save_context_note(p_user uuid, p_key text, p_title text, p_folder text, p_content text, p_expected timestamptz default null)
returns knowledge_notes language plpgsql security invoker set search_path=public as $$
declare existing knowledge_notes; result knowledge_notes;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_key, 0));
  select * into existing from knowledge_notes where user_id=p_user and external_key=p_key for update;
  if found then
    if existing.title=p_title and existing.folder=p_folder and existing.content=p_content then return existing; end if;
    if p_expected is null or existing.updated_at <> p_expected then raise exception 'Context changed; read the latest note and merge before saving.' using errcode='40001'; end if;
    update knowledge_notes set title=p_title,folder=p_folder,content=p_content,
      aliases=case when title<>p_title or folder<>p_folder then array_append(array_append(aliases,title),case when folder='' then title else folder||'/'||title end) else aliases end
      where id=existing.id returning * into result;
  else
    if p_expected is not null then raise exception 'Note no longer exists; read before saving.' using errcode='40001'; end if;
    insert into knowledge_notes(user_id,external_key,title,folder,content) values(p_user,p_key,p_title,p_folder,p_content) returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.save_context_note(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_context_note(uuid,text,text,text,text,timestamptz) to service_role;
do $$ begin alter publication supabase_realtime add table knowledge_notes;
exception when duplicate_object then null; end $$;

commit;
