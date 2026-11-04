-- Milestone 3: Script and Casting.
-- scenes.script already holds each scene's elements; the scene's cast and location are derived
-- from that text (speaker cues, action mentions, heading location), so they are not stored twice.

-- Card position on the Casting canvas, separate from the Story canvas (characters.canvas).
alter table public.characters add column cast_canvas jsonb not null default '{}'::jsonb;
alter table public.environments add column cast_canvas jsonb not null default '{}'::jsonb;

-- The asset shown on a cast card (one per owner).
alter table public.characters add column active_asset_id uuid references public.assets (id) on delete set null;
alter table public.environments add column active_asset_id uuid references public.assets (id) on delete set null;
create index characters_active_asset_id_idx on public.characters (active_asset_id);
create index environments_active_asset_id_idx on public.environments (active_asset_id);

-- Scene element types are validated at the edge (zod); keep a cheap structural guard here.
alter table public.scenes add constraint scenes_script_is_array check (jsonb_typeof(script) = 'array');
