-- Milestone 2: Idea and Story stages.

alter table public.projects
  add column runtime_seconds int not null default 180 check (runtime_seconds between 10 and 7200),
  add column idea text not null default '' check (char_length(idea) <= 60000),
  add column logline text not null default '' check (char_length(logline) <= 400),
  add column generated_by text check (generated_by in ('openai', 'offline'));

alter table public.story_beats
  add column act text not null default '' check (char_length(act) <= 60);

-- Character bio fields (role, description, want, need, arc) live in characters.bio;
-- card position in characters.canvas. Relationships are their own rows.
create table public.character_relationships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  from_id uuid not null,
  to_id uuid not null,
  label text not null default '' check (char_length(label) <= 80),
  check (from_id <> to_id),
  foreign key (from_id, project_id) references public.characters (id, project_id) on delete cascade,
  foreign key (to_id, project_id) references public.characters (id, project_id) on delete cascade
);
-- One link per pair regardless of direction.
create unique index character_relationships_pair_idx
  on public.character_relationships (project_id, least(from_id, to_id), greatest(from_id, to_id));
create index character_relationships_from_id_idx on public.character_relationships (from_id);
create index character_relationships_to_id_idx on public.character_relationships (to_id);

grant select, insert, update, delete on public.character_relationships to authenticated;
grant all on public.character_relationships to service_role;

alter table public.character_relationships enable row level security;

create policy character_relationships_select on public.character_relationships for select to authenticated
  using (private.can_read(project_id));
create policy character_relationships_insert on public.character_relationships for insert to authenticated
  with check (private.can_edit(project_id));
create policy character_relationships_update on public.character_relationships for update to authenticated
  using (private.can_edit(project_id)) with check (private.can_edit(project_id));
create policy character_relationships_delete on public.character_relationships for delete to authenticated
  using (private.can_edit(project_id));
