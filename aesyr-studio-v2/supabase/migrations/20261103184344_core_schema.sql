-- Aesyr Studio v2: core schema (milestone 1).
-- Every table in `public` has RLS. Membership checks live in the non-exposed `private`
-- schema; credit and job mutations are server-only (service_role) through private functions.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared enums (as check-constrained text so they can grow without type churn)
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Library (narrative structures and scene presets)
-- ---------------------------------------------------------------------------

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('narrative', 'scene_preset')),
  scope text not null check (scope in ('builtin', 'user')),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  version int not null default 1 check (version > 0),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- built-ins have no owner; user entries always do
  check ((scope = 'builtin') = (owner_id is null))
);
create index library_entries_owner_id_idx on public.library_entries (owner_id) where owner_id is not null;
create index library_entries_kind_idx on public.library_entries (kind);
create trigger library_entries_touch before update on public.library_entries
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9', '2.39:1', '9:16', '1:1', '4:5')),
  narrative_id uuid references public.library_entries (id) on delete set null,
  scene_preset_id uuid references public.library_entries (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_created_by_idx on public.projects (created_by);
create index projects_narrative_id_idx on public.projects (narrative_id);
create index projects_scene_preset_id_idx on public.projects (scene_preset_id);
create trigger projects_touch before update on public.projects
  for each row execute function private.touch_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'editor', 'commenter', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members (user_id);

-- Membership helpers. SECURITY DEFINER so policies on project_members itself don't recurse;
-- each one only ever answers for the calling user (auth.uid()).
create or replace function private.project_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.project_members m
  where m.project_id = p_project and m.user_id = (select auth.uid());
$$;

create or replace function private.can_read(p_project uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.project_role(p_project) is not null;
$$;

create or replace function private.can_edit(p_project uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.project_role(p_project) in ('owner', 'manager', 'editor'), false);
$$;

create or replace function private.can_manage(p_project uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.project_role(p_project) in ('owner', 'manager'), false);
$$;

create or replace function private.shares_project(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on b.project_id = a.project_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- The creator becomes owner.
create or replace function private.add_project_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger projects_add_owner
  after insert on public.projects
  for each row execute function private.add_project_owner();

-- ---------------------------------------------------------------------------
-- Pipeline stages
-- ---------------------------------------------------------------------------

create table public.stage_approvals (
  project_id uuid not null references public.projects (id) on delete cascade,
  stage text not null check (stage in ('idea', 'story', 'script', 'shots', 'motion')),
  approved_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  approved_at timestamptz not null default now(),
  primary key (project_id, stage)
);
create index stage_approvals_approved_by_idx on public.stage_approvals (approved_by);

-- ---------------------------------------------------------------------------
-- Story, cast, scenes, shots
-- (id, project_id) is unique on each parent so children can use composite foreign
-- keys: a row can never reference a parent in a different project.
-- ---------------------------------------------------------------------------

create table public.story_beats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null check (position >= 0),
  beat_key text not null default '',
  title text not null default '',
  summary text not null default '',
  color smallint not null default 1 check (color between 1 and 9),
  target_seconds numeric(8, 2) check (target_seconds is null or target_seconds >= 0),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);
create index story_beats_project_position_idx on public.story_beats (project_id, position);
create trigger story_beats_touch before update on public.story_beats
  for each row execute function private.touch_updated_at();

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  bio jsonb not null default '{}'::jsonb,
  canvas jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);
create index characters_project_id_idx on public.characters (project_id);
create trigger characters_touch before update on public.characters
  for each row execute function private.touch_updated_at();

create table public.environments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  canvas jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);
create index environments_project_id_idx on public.environments (project_id);
create trigger environments_touch before update on public.environments
  for each row execute function private.touch_updated_at();

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null check (position >= 0),
  heading text not null default '',
  script jsonb not null default '[]'::jsonb,
  beat_id uuid,
  scene_preset_id uuid references public.library_entries (id) on delete set null,
  color smallint not null default 1 check (color between 1 and 9),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (beat_id, project_id) references public.story_beats (id, project_id) on delete set null (beat_id)
);
create index scenes_project_position_idx on public.scenes (project_id, position);
create index scenes_beat_id_idx on public.scenes (beat_id);
create index scenes_scene_preset_id_idx on public.scenes (scene_preset_id);
create trigger scenes_touch before update on public.scenes
  for each row execute function private.touch_updated_at();

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  scene_id uuid not null,
  position int not null check (position >= 0),
  title text not null default '',
  description text not null default '',
  start_s numeric(10, 3) not null default 0 check (start_s >= 0),
  length_s numeric(10, 3) not null default 3 check (length_s > 0),
  size text check (size in ('ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'WS', 'EWS')),
  view text not null default '',
  angle text not null default '',
  movement text not null default '',
  location_id uuid,
  anchor_word text,
  locked boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'ready', 'approved')),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (scene_id, project_id) references public.scenes (id, project_id) on delete cascade,
  foreign key (location_id, project_id) references public.environments (id, project_id) on delete set null (location_id)
);
create index shots_scene_position_idx on public.shots (scene_id, position);
create index shots_project_id_idx on public.shots (project_id);
create index shots_location_id_idx on public.shots (location_id);
create trigger shots_touch before update on public.shots
  for each row execute function private.touch_updated_at();

create table public.shot_cast (
  project_id uuid not null,
  shot_id uuid not null,
  character_id uuid not null,
  primary key (shot_id, character_id),
  foreign key (shot_id, project_id) references public.shots (id, project_id) on delete cascade,
  foreign key (character_id, project_id) references public.characters (id, project_id) on delete cascade
);
create index shot_cast_character_id_idx on public.shot_cast (character_id);
create index shot_cast_project_id_idx on public.shot_cast (project_id);

-- One Director timeline per scene. `doc` holds tracks, clips and markers (Section 5 model);
-- `revision` supports optimistic concurrency until realtime sync lands.
create table public.timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  scene_id uuid not null unique,
  fps smallint not null default 24 check (fps in (24, 25, 30, 48, 50, 60)),
  duration_s numeric(10, 3) not null default 0 check (duration_s >= 0),
  doc jsonb not null default '{"tracks":[],"clips":[],"markers":[]}'::jsonb,
  revision int not null default 0,
  updated_at timestamptz not null default now(),
  foreign key (scene_id, project_id) references public.scenes (id, project_id) on delete cascade
);
create index timelines_project_id_idx on public.timelines (project_id);
create trigger timelines_touch before update on public.timelines
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Assets (2D images, code-3D, GLBs, audio, motion clips, references)
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('image', 'code3d', 'glb', 'audio', 'motion', 'reference')),
  character_id uuid,
  environment_id uuid,
  shot_id uuid,
  storage_path text check (storage_path is null or char_length(storage_path) <= 512),
  provider text check (provider in ('upload', 'google', 'openai', 'tripo', 'unimate', 'blender')),
  prompt text not null default '',
  meta jsonb not null default '{}'::jsonb,
  version int not null default 1 check (version > 0),
  credits_spent int not null default 0 check (credits_spent >= 0),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- an asset belongs to at most one owner record
  check (num_nonnulls(character_id, environment_id, shot_id) <= 1),
  foreign key (character_id, project_id) references public.characters (id, project_id) on delete cascade,
  foreign key (environment_id, project_id) references public.environments (id, project_id) on delete cascade,
  foreign key (shot_id, project_id) references public.shots (id, project_id) on delete cascade
);
create index assets_project_id_idx on public.assets (project_id);
create index assets_character_id_idx on public.assets (character_id) where character_id is not null;
create index assets_environment_id_idx on public.assets (environment_id) where environment_id is not null;
create index assets_shot_id_idx on public.assets (shot_id) where shot_id is not null;
create index assets_created_by_idx on public.assets (created_by);

-- ---------------------------------------------------------------------------
-- Jobs and credits (credits belong to each user)
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null check (kind in (
    'llm_story', 'llm_shot_plan', 'llm_code3d', 'image_google', 'tripo_model', 'tripo_rig',
    'unimate_motion', 'blender_retarget', 'reference_analysis', 'ltx_preview', 'export_zip')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  cost_estimate int not null check (cost_estimate >= 0),
  cost_actual int check (cost_actual >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, idempotency_key)
);
create index jobs_project_id_idx on public.jobs (project_id);
create index jobs_active_idx on public.jobs (status, created_at) where status in ('queued', 'running');
create trigger jobs_touch before update on public.jobs
  for each row execute function private.touch_updated_at();

-- Append-only. balance(user) = sum(delta).
-- reserve: -estimate at queue time; on success: release (+estimate) then charge (-actual);
-- on failure/cancel: refund (+estimate).
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('grant', 'reserve', 'release', 'charge', 'refund', 'adjustment')),
  job_id uuid references public.jobs (id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index credit_ledger_user_id_idx on public.credit_ledger (user_id, created_at);
create index credit_ledger_job_id_idx on public.credit_ledger (job_id) where job_id is not null;

create or replace function private.forbid_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$;

create trigger credit_ledger_append_only
  before update or delete on public.credit_ledger
  for each row execute function private.forbid_ledger_change();

-- Caller's own balance. SECURITY INVOKER: RLS limits the sum to the caller's rows.
create or replace function public.credit_balance()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(delta), 0)::bigint from public.credit_ledger
  where user_id = (select auth.uid());
$$;

-- Server-only credit operations (called with the service role by the API).
-- A per-user transaction advisory lock serialises concurrent reservations.

create or replace function private.grant_credits(p_user uuid, p_amount int, p_note text default '')
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_amount <= 0 then
    raise exception 'grant must be positive';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, note) values (p_user, p_amount, 'grant', p_note);
end;
$$;

create or replace function private.reserve_job(
  p_user uuid, p_project uuid, p_kind text, p_input jsonb, p_cost int, p_idempotency_key text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job uuid;
  v_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  -- idempotent retry: return the job already created for this key
  select id into v_job from public.jobs where user_id = p_user and idempotency_key = p_idempotency_key;
  if found then
    return v_job;
  end if;

  if p_project is not null and not exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = p_user and role in ('owner', 'manager', 'editor')
  ) then
    raise exception 'user cannot run jobs in this project' using errcode = '42501';
  end if;

  select coalesce(sum(delta), 0) into v_balance from public.credit_ledger where user_id = p_user;
  if v_balance < p_cost then
    raise exception 'insufficient credits: balance %, cost %', v_balance, p_cost using errcode = 'P0001';
  end if;

  insert into public.jobs (user_id, project_id, kind, input, cost_estimate, idempotency_key)
  values (p_user, p_project, p_kind, coalesce(p_input, '{}'::jsonb), p_cost, p_idempotency_key)
  returning id into v_job;

  if p_cost > 0 then
    insert into public.credit_ledger (user_id, delta, reason, job_id) values (p_user, -p_cost, 'reserve', v_job);
  end if;
  return v_job;
end;
$$;

create or replace function private.finish_job(p_job uuid, p_succeeded boolean, p_cost_actual int, p_output jsonb, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then
    raise exception 'job % not found', p_job;
  end if;
  if j.status not in ('queued', 'running') then
    return; -- already finished: callbacks may be delivered twice
  end if;

  if p_succeeded then
    if p_cost_actual is null or p_cost_actual < 0 or p_cost_actual > j.cost_estimate then
      raise exception 'actual cost must be between 0 and the reserved %', j.cost_estimate;
    end if;
    if j.cost_estimate > 0 then
      insert into public.credit_ledger (user_id, delta, reason, job_id) values (j.user_id, j.cost_estimate, 'release', j.id);
    end if;
    if p_cost_actual > 0 then
      insert into public.credit_ledger (user_id, delta, reason, job_id) values (j.user_id, -p_cost_actual, 'charge', j.id);
    end if;
    update public.jobs set status = 'succeeded', cost_actual = p_cost_actual, output = p_output, finished_at = now()
    where id = j.id;
  else
    if j.cost_estimate > 0 then
      insert into public.credit_ledger (user_id, delta, reason, job_id) values (j.user_id, j.cost_estimate, 'refund', j.id);
    end if;
    update public.jobs set status = 'failed', cost_actual = 0, error = p_error, finished_at = now()
    where id = j.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: explicit, least privilege. anon gets nothing.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema private from public, anon;
revoke execute on function public.credit_balance() from public, anon;

grant select, insert, update, delete on
  public.projects, public.project_members, public.stage_approvals, public.story_beats,
  public.characters, public.environments, public.scenes, public.shots, public.shot_cast,
  public.timelines, public.assets, public.library_entries
  to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.jobs, public.credit_ledger to authenticated;
grant execute on function public.credit_balance() to authenticated;

-- Policies call these as the querying role.
grant execute on function
  private.project_role(uuid), private.can_read(uuid), private.can_edit(uuid),
  private.can_manage(uuid), private.shares_project(uuid)
  to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.library_entries enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.stage_approvals enable row level security;
alter table public.story_beats enable row level security;
alter table public.characters enable row level security;
alter table public.environments enable row level security;
alter table public.scenes enable row level security;
alter table public.shots enable row level security;
alter table public.shot_cast enable row level security;
alter table public.timelines enable row level security;
alter table public.assets enable row level security;
alter table public.jobs enable row level security;
alter table public.credit_ledger enable row level security;

-- profiles: yourself and people you share a project with
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_project(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- library: built-ins for everyone signed in; user entries for their owner only
create policy library_select on public.library_entries for select to authenticated
  using (scope = 'builtin' or owner_id = (select auth.uid()));
create policy library_insert on public.library_entries for insert to authenticated
  with check (scope = 'user' and owner_id = (select auth.uid()));
create policy library_update on public.library_entries for update to authenticated
  using (scope = 'user' and owner_id = (select auth.uid()))
  with check (scope = 'user' and owner_id = (select auth.uid()));
create policy library_delete on public.library_entries for delete to authenticated
  using (scope = 'user' and owner_id = (select auth.uid()));

-- projects (creator may read the row it just inserted, before the owner trigger's row is visible)
create policy projects_select on public.projects for select to authenticated
  using (created_by = (select auth.uid()) or private.can_read(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy projects_update on public.projects for update to authenticated
  using (private.can_manage(id)) with check (private.can_manage(id));
create policy projects_delete on public.projects for delete to authenticated
  using (private.project_role(id) = 'owner');

-- members: everyone in the project sees the list; managers edit it; only owners grant owner
create policy members_select on public.project_members for select to authenticated
  using (private.can_read(project_id));
create policy members_insert on public.project_members for insert to authenticated
  with check (private.can_manage(project_id) and (role <> 'owner' or private.project_role(project_id) = 'owner'));
create policy members_update on public.project_members for update to authenticated
  using (private.can_manage(project_id))
  with check (private.can_manage(project_id) and (role <> 'owner' or private.project_role(project_id) = 'owner'));
create policy members_delete on public.project_members for delete to authenticated
  using (private.can_manage(project_id) or user_id = (select auth.uid()));

-- stage approvals: readable by members, set by owners/managers
create policy approvals_select on public.stage_approvals for select to authenticated
  using (private.can_read(project_id));
create policy approvals_insert on public.stage_approvals for insert to authenticated
  with check (private.can_manage(project_id) and approved_by = (select auth.uid()));
create policy approvals_delete on public.stage_approvals for delete to authenticated
  using (private.can_manage(project_id));

-- project content: read for members, write for owner/manager/editor
do $$
declare
  t text;
begin
  foreach t in array array['story_beats', 'characters', 'environments', 'scenes', 'shots', 'shot_cast', 'timelines', 'assets']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (private.can_read(project_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (private.can_edit(project_id))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (private.can_edit(project_id)) with check (private.can_edit(project_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (private.can_edit(project_id))', t);
  end loop;
end;
$$;

-- jobs: your own, plus jobs in projects you can read (to show progress to the team)
create policy jobs_select on public.jobs for select to authenticated
  using (user_id = (select auth.uid()) or (project_id is not null and private.can_read(project_id)));

-- credits: your own ledger only; no client writes (service role only)
create policy ledger_select on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()));
