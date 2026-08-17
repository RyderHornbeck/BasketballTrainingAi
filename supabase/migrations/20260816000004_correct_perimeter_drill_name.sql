-- Normalize the catalog source and every generated workout that still carries
-- the original misspelled drill name.
update public.exercise_video_clips
set exercise_name = regexp_replace(
  exercise_name,
  '\mPetimeter\M',
  'Perimeter',
  'g'
)
where exercise_name ~* '\mPetimeter\M';

update public.workout_exercises
set name = regexp_replace(
  name,
  '\mPetimeter\M',
  'Perimeter',
  'g'
)
where name ~* '\mPetimeter\M';
