-- Keep catalog names and existing workout/edit-history references aligned.
update public.exercise_video_clips
set exercise_name = replace(exercise_name, 'Tween', 'Between')
where exercise_name like '%Tween%';

update public.workout_exercises
set name = replace(name, 'Tween', 'Between')
where name like '%Tween%';

update public.workout_edit_operations
set exercise_snapshot = replace(exercise_snapshot::text, 'Tween', 'Between')::jsonb
where exercise_snapshot::text like '%Tween%';

update public.workout_edit_revisions
set
  before_snapshot = replace(before_snapshot::text, 'Tween', 'Between')::jsonb,
  after_snapshot = replace(after_snapshot::text, 'Tween', 'Between')::jsonb
where before_snapshot::text like '%Tween%'
   or after_snapshot::text like '%Tween%';
