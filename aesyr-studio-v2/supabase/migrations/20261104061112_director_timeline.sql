-- Milestone 5: Director timeline.
-- public.timelines (one per scene, `doc` jsonb, `revision` for optimistic concurrency) already
-- exists. The shot track is not stored in `doc`: it is derived from public.shots (order + length_s),
-- so timeline edits to shots are written to the shots table itself.

-- Structural guard on the document; clip-level validation happens at the API edge (zod).
alter table public.timelines add constraint timelines_doc_shape check (
  jsonb_typeof(doc) = 'object'
  and jsonb_typeof(doc -> 'tracks') = 'array'
  and jsonb_typeof(doc -> 'clips') = 'array'
  and jsonb_typeof(doc -> 'markers') = 'array'
);

-- Timeline audio files are assets of kind 'audio' attached to the project (no owner record).
create index assets_project_kind_idx on public.assets (project_id, kind);

-- Bump `revision` on every write so concurrent editors can detect stale saves.
create or replace function private.bump_timeline_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger timelines_bump_revision
  before update on public.timelines
  for each row execute function private.bump_timeline_revision();
