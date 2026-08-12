-- Keep the catalog, active workout rows, and editor history aligned when
-- replacing the inaccurate "through" wording with the actual drill name.
update public.exercise_video_clips
set exercise_name = 'Lateral Dribble with between the legs'
where lower(trim(exercise_name)) in (
  'lateral dribble with thru the legs',
  'lateral dribble w/ thru the legs'
);

update public.workout_exercises
set name = 'Lateral Dribble with between the legs'
where lower(trim(name)) in (
  'lateral dribble with thru the legs',
  'lateral dribble w/ thru the legs'
);

update public.workout_edit_operations
set exercise_snapshot = replace(
  replace(
    exercise_snapshot::text,
    'Lateral Dribble with Thru the Legs',
    'Lateral Dribble with between the legs'
  ),
  'Lateral Dribble w/ thru the legs',
  'Lateral Dribble with between the legs'
)::jsonb
where exercise_snapshot::text ilike '%Lateral Dribble with Thru the Legs%'
   or exercise_snapshot::text ilike '%Lateral Dribble w/ thru the legs%';

update public.workout_edit_revisions
set before_snapshot = replace(
      replace(
        before_snapshot::text,
        'Lateral Dribble with Thru the Legs',
        'Lateral Dribble with between the legs'
      ),
      'Lateral Dribble w/ thru the legs',
      'Lateral Dribble with between the legs'
    )::jsonb,
    after_snapshot = replace(
      replace(
        after_snapshot::text,
        'Lateral Dribble with Thru the Legs',
        'Lateral Dribble with between the legs'
      ),
      'Lateral Dribble w/ thru the legs',
      'Lateral Dribble with between the legs'
    )::jsonb
where before_snapshot::text ilike '%Lateral Dribble with Thru the Legs%'
   or before_snapshot::text ilike '%Lateral Dribble w/ thru the legs%'
   or after_snapshot::text ilike '%Lateral Dribble with Thru the Legs%'
   or after_snapshot::text ilike '%Lateral Dribble w/ thru the legs%';
