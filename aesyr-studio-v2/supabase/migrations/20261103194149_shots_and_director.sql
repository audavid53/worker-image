-- Milestone 4: shot list and Director canvas.
-- shots already carry title, description, length_s, size, view, angle, movement, location_id and
-- status; shot_cast links characters. Start times are derived from scene and shot order.

alter table public.shots add column note text not null default '' check (char_length(note) <= 2000);

-- Node positions on the Director canvas.
alter table public.scenes add column director_canvas jsonb not null default '{}'::jsonb;
alter table public.characters add column director_canvas jsonb not null default '{}'::jsonb;
alter table public.environments add column director_canvas jsonb not null default '{}'::jsonb;

-- Keep the shot vocabulary honest at the database edge (the UI offers exactly these).
alter table public.shots add constraint shots_view_check check (view in (
  '', 'Front view', 'Three-quarter', 'Side view', 'Back view', 'Over-the-shoulder', 'POV', 'Overhead'));
alter table public.shots add constraint shots_angle_check check (angle in (
  '', 'Eye level', 'Low angle', 'High angle', 'Ground level', 'Shoulder level', 'Hip level', 'Bird''s-eye', 'Dutch angle'));
alter table public.shots add constraint shots_movement_check check (movement in (
  '', 'Static', 'Pan', 'Tilt', 'Push in', 'Pull out', 'Tracking shot', 'Dolly', 'Crane', 'Orbit', 'Handheld', 'Zoom'));
