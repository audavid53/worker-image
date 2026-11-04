-- Milestone 6: the Narrative and Scene Preset libraries.

-- Stable text identity for entries ('three-act', 'continuous-glide', 'my-…').
alter table public.library_entries add column slug text;
update public.library_entries set slug = id::text where slug is null;
alter table public.library_entries alter column slug set not null;
alter table public.library_entries add constraint library_entries_slug_format check (slug ~ '^[a-z0-9-]{1,60}$');

-- One built-in per (kind, slug); each user's own entries are unique per (owner, kind, slug).
create unique index library_entries_builtin_slug_idx on public.library_entries (kind, slug) where scope = 'builtin';
create unique index library_entries_user_slug_idx on public.library_entries (owner_id, kind, slug) where scope = 'user';

-- Cheap shape guard; full validation is the zod schema at the API edge.
-- coalesce: a missing key makes jsonb_typeof NULL, and a NULL check result would pass.
alter table public.library_entries add constraint library_entries_data_shape check (
  jsonb_typeof(data) = 'object'
  and (kind <> 'narrative' or coalesce(jsonb_typeof(data -> 'beats'), '') = 'array')
  and (kind <> 'scene_preset' or coalesce(jsonb_typeof(data -> 'camera'), '') = 'object')
);

-- Projects (and scenes) keep a snapshot of the entries they were made with, so editing or
-- deleting a library entry never changes an existing film.
alter table public.projects
  add column narrative_snapshot jsonb,
  add column scene_preset_snapshot jsonb;
