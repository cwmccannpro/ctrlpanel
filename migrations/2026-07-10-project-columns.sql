-- ============================================================
-- Fix: projects table is missing columns the app writes to.
-- Symptom: saving Excalidraw / Charter / Notes / To Do link fails with
-- Postgres error 42703 "column does not exist".
-- Safe to run multiple times (all guarded by "if not exists").
-- Run in: Supabase dashboard → SQL Editor → paste → Run.
-- ============================================================

-- Project Dashboard fields
alter table projects add column if not exists charter jsonb default '{}'::jsonb;
alter table projects add column if not exists notes_list jsonb default '[]'::jsonb;

-- Excalidraw canvas (serialized scene) + webp preview thumbnail (data URL)
alter table projects add column if not exists excalidraw jsonb;
alter table projects add column if not exists excalidraw_preview text;

-- Link a project to a single To Do board (mirrors crm_board_id)
alter table projects add column if not exists todo_board_id uuid references boards(id) on delete set null;
