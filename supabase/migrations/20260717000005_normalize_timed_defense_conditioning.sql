with active_timed_exercises as (
  select
    exercise.id,
    coalesce(
      nullif(
        substring(exercise.duration from '([0-9]+(?:\.[0-9]+)?)\s*min'),
        ''
      )::numeric,
      2
    ) as existing_minutes
  from public.workout_exercises exercise
  join public.workout_days day on day.id = exercise.day_id
  join public.workout_plans plan on plan.id = day.plan_id
  where plan.active = true
    and exercise.category in ('defense', 'conditioning')
)
update public.workout_exercises exercise
set
  log_type = 'minutes',
  duration = concat(greatest(1::numeric, least(3::numeric, active_timed_exercises.existing_minutes)), ' min')
from active_timed_exercises
where exercise.id = active_timed_exercises.id;
