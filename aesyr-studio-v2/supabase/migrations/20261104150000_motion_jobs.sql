-- Motion jobs (shared/motion.ts, server/jobs.ts): Tripo characters/rigs/presets, UniMate text-to-motion
-- and Blender object motion. A job runs as ordered provider steps; each step's provider task id is kept
-- so polling (and RunPod/Tripo webhooks later) can find the job without scanning.

alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in (
  'llm_story', 'llm_shot_plan', 'llm_code3d', 'image_google', 'tripo_model', 'tripo_rig',
  'unimate_motion', 'blender_retarget', 'reference_analysis', 'ltx_preview', 'export_zip',
  'tripo_character', 'blender_motion'));

alter table public.jobs
  add column steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array'),
  add column provider_ref text
    check (provider_ref is null or char_length(provider_ref) between 1 and 200);

comment on column public.jobs.steps is
  'Ordered provider steps: [{name, ref, progress, done}]. Written by the service role only.';
comment on column public.jobs.provider_ref is
  'The running step''s provider id (Tripo task id or RunPod job id), for webhook lookup.';

create index jobs_provider_ref_idx on public.jobs (provider_ref) where provider_ref is not null;
