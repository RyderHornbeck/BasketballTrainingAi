-- Pound-dribble drills should always be prescribed and displayed by hand.
-- The catalog flag drives plan generation, manual additions, and AI edits.
update public.exercise_video_clips
set requires_both_sides = true
where category = 'ball_handling'
  and lower(exercise_name) like '%pound%';

-- Backfill already-created workouts without changing their prescribed volume
-- or recorded progress. Alternating labels preserve each existing set number.
update public.workout_exercises we
set set_side_labels = labels.values
from (
  select
    id,
    array_agg(
      case when set_number % 2 = 1 then 'Right side' else 'Left side' end
      order by set_number
    ) as values
  from public.workout_exercises
  cross join lateral generate_series(
    1,
    greatest(1, coalesce(substring(sets from '^[0-9]+')::integer, 1))
  ) as set_number
  where category = 'ball_handling'
    and lower(name) like '%pound%'
  group by id
) as labels
where we.id = labels.id;
