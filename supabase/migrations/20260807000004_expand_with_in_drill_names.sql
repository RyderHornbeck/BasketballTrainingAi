-- Keep catalog results and already-generated workouts using the same readable
-- drill name. The separator guards against changing incidental URL-like text.
update public.exercise_video_clips
set exercise_name = regexp_replace(
  exercise_name,
  '(^|[[:space:]])w/',
  '\1with',
  'gi'
)
where exercise_name ~* '(^|[[:space:]])w/';

update public.workout_exercises
set name = regexp_replace(
  name,
  '(^|[[:space:]])w/',
  '\1with',
  'gi'
)
where name ~* '(^|[[:space:]])w/';

-- Undo snapshots contain complete exercise objects. Normalize them too so an
-- undo cannot restore an abbreviated name after the live rows are corrected.
update public.workout_edit_operations
set exercise_snapshot = regexp_replace(
  exercise_snapshot::text,
  '(^|[[:space:]])w/',
  '\1with',
  'gi'
)::jsonb
where exercise_snapshot::text ~* '(^|[[:space:]])w/';

update public.workout_edit_revisions
set before_snapshot = regexp_replace(
      before_snapshot::text,
      '(^|[[:space:]])w/',
      '\1with',
      'gi'
    )::jsonb,
    after_snapshot = regexp_replace(
      after_snapshot::text,
      '(^|[[:space:]])w/',
      '\1with',
      'gi'
    )::jsonb
where before_snapshot::text ~* '(^|[[:space:]])w/'
   or after_snapshot::text ~* '(^|[[:space:]])w/';

-- Correct this catalog instruction in existing plans and their undo history.
update public.exercise_video_clips
set description = replace(
  description,
  'Dribble from the ball through your legs',
  'Dribble the ball through your legs'
)
where description like '%Dribble from the ball through your legs%';

update public.workout_exercises
set instructions = replace(
  instructions,
  'Dribble from the ball through your legs',
  'Dribble the ball through your legs'
)
where instructions like '%Dribble from the ball through your legs%';

update public.workout_edit_operations
set exercise_snapshot = replace(
  exercise_snapshot::text,
  'Dribble from the ball through your legs',
  'Dribble the ball through your legs'
)::jsonb
where exercise_snapshot::text like '%Dribble from the ball through your legs%';

update public.workout_edit_revisions
set before_snapshot = replace(
      before_snapshot::text,
      'Dribble from the ball through your legs',
      'Dribble the ball through your legs'
    )::jsonb,
    after_snapshot = replace(
      after_snapshot::text,
      'Dribble from the ball through your legs',
      'Dribble the ball through your legs'
    )::jsonb
where before_snapshot::text like '%Dribble from the ball through your legs%'
   or after_snapshot::text like '%Dribble from the ball through your legs%';
