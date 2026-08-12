-- Correct the athlete-facing drill name everywhere it can be restored from.
update public.exercise_video_clips
set exercise_name = 'Half Spin Into Fadeaway'
where exercise_name = 'Half Spin Into Fadeaay';

update public.workout_exercises
set name = 'Half Spin Into Fadeaway'
where name = 'Half Spin Into Fadeaay';

update public.workout_edit_operations
set exercise_snapshot = replace(
  exercise_snapshot::text,
  'Half Spin Into Fadeaay',
  'Half Spin Into Fadeaway'
)::jsonb
where exercise_snapshot::text like '%Half Spin Into Fadeaay%';

update public.workout_edit_revisions
set before_snapshot = replace(
      before_snapshot::text,
      'Half Spin Into Fadeaay',
      'Half Spin Into Fadeaway'
    )::jsonb,
    after_snapshot = replace(
      after_snapshot::text,
      'Half Spin Into Fadeaay',
      'Half Spin Into Fadeaway'
    )::jsonb
where before_snapshot::text like '%Half Spin Into Fadeaay%'
   or after_snapshot::text like '%Half Spin Into Fadeaay%';
