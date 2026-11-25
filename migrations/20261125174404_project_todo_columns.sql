-- Per-project To Do column. An existing board link stays available as the
-- default board in the picker until the owner selects a column.
alter table public.projects add column if not exists todo_column_name text;
create index if not exists projects_todo_column_idx
  on public.projects (todo_board_id, todo_column_name) where todo_column_name is not null;
create index if not exists tasks_board_column_idx on public.tasks (board_id, column_name);

create or replace function public.check_project_todo_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  board_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  if new.todo_board_id is null then
    new.todo_column_name := null;
  elsif new.todo_column_name is not null then
    select b.columns into board_columns from public.boards b
      where b.id = new.todo_board_id and b.user_id = new.user_id for share;
    if not found then
      raise exception 'Choose a To Do board you own.';
    end if;
    board_columns := case when jsonb_typeof(board_columns) = 'array' and board_columns <> '[]'::jsonb
      then board_columns else default_columns end;
    if not (board_columns ? new.todo_column_name) then
      raise exception 'That To Do column is no longer available. Choose another column.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_project_todo_column on public.projects;
create trigger check_project_todo_column
  before insert or update of todo_board_id, todo_column_name, user_id on public.projects
  for each row execute function public.check_project_todo_column();

-- Check cards entering a board. Older clients save column renames and same-board
-- card moves separately, so leave those edits to the client or the atomic RPC.
create or replace function public.check_task_todo_column()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  board_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  if new.board_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.board_id is not distinct from new.board_id and old.user_id is not distinct from new.user_id then
      return new;
    end if;
  end if;
  -- Board RLS already includes owners and accepted collaborators.
  select b.columns into board_columns from public.boards b
    where b.id = new.board_id for share;
  if not found then
    raise exception 'That To Do board is no longer available.';
  end if;
  board_columns := case when jsonb_typeof(board_columns) = 'array' and board_columns <> '[]'::jsonb
    then board_columns else default_columns end;
  if new.column_name is null or not (board_columns ? new.column_name) then
    raise exception 'That To Do column is no longer available. Refresh the board and try again.';
  end if;
  return new;
end;
$$;

drop trigger if exists check_task_todo_column on public.tasks;
create trigger check_task_todo_column
  before insert or update of board_id, column_name, user_id on public.tasks
  for each row execute function public.check_task_todo_column();

create or replace function public.update_todo_columns(
  p_board_id uuid, p_expected jsonb, p_columns jsonb,
  p_previous_name text default null, p_target_name text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_columns jsonb;
  default_columns constant jsonb := '["Backlog","In Progress","Review","Done"]'::jsonb;
begin
  select b.columns into current_columns from public.boards b
    where b.id = p_board_id and b.user_id = owner_id for update;
  if not found then
    raise exception 'This To Do board is no longer available.';
  end if;
  current_columns := case when jsonb_typeof(current_columns) = 'array' and current_columns <> '[]'::jsonb
    then current_columns else default_columns end;
  if current_columns is distinct from p_expected then
    raise exception 'The columns changed in another window. Try again with the refreshed board.';
  end if;
  if jsonb_typeof(p_columns) is distinct from 'array' then
    raise exception 'Enter at least one column.';
  end if;
  if jsonb_array_length(p_columns) = 0 or exists (
    select 1 from jsonb_array_elements(p_columns) as entries(value)
    group by value having count(*) > 1 or jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') = ''
  ) then
    raise exception 'Use unique, non-empty column names.';
  end if;
  if p_previous_name is null then
    if p_target_name is not null or not (p_columns @> current_columns) then
      raise exception 'Specify a destination when removing a To Do column.';
    end if;
  elsif p_target_name is null or not (current_columns ? p_previous_name)
    or p_columns ? p_previous_name or not (p_columns ? p_target_name)
    or not (p_columns @> (current_columns - p_previous_name)) then
    raise exception 'The source or destination column is invalid.';
  end if;

  update public.boards set columns = p_columns where id = p_board_id and user_id = owner_id;

  if p_previous_name is not null then
    update public.tasks set column_name = p_target_name
      where board_id = p_board_id and column_name = p_previous_name;
    update public.projects
      set todo_column_name = case when current_columns ? p_target_name then null else p_target_name end
      where todo_board_id = p_board_id and user_id = owner_id and todo_column_name = p_previous_name;
  end if;
end;
$$;

revoke all on function public.check_project_todo_column() from public, anon, authenticated;
revoke all on function public.check_task_todo_column() from public, anon, authenticated;
revoke all on function public.update_todo_columns(uuid, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.update_todo_columns(uuid, jsonb, jsonb, text, text) to authenticated;
