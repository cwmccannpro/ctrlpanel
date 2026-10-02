-- Retire CTRLpanel collaboration features while preserving historical rows.
-- Run this once against an existing Supabase project. It is safe to re-run.

drop policy if exists "shared boards read" on boards;
drop policy if exists "shared boards update" on boards;
drop policy if exists "shared board tasks" on tasks;

do $$ begin
  if to_regclass('public.board_shares') is not null then
    execute 'drop policy if exists "share parties read" on public.board_shares';
    execute 'drop policy if exists "share parties delete" on public.board_shares';
  end if;
end $$;

drop function if exists public.can_access_board(uuid);
drop function if exists public.is_board_owner(uuid);
