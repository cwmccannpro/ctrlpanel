-- Socials is modular: every connected channel is its own renameable section in
-- the sidebar. `label` holds the user's own name for it; when it is null the UI
-- falls back to the real YouTube channel title.
-- supabase-schema.sql remains the authoritative full schema.

alter table youtube_channels
  add column if not exists label text;
