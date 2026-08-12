-- Remove the retired finishing drill from the catalog, active workouts, and
-- editor revisions so it cannot be restored through Undo.
create temporary table retired_closed_eyed_clips on commit drop as
select id
from public.exercise_video_clips
where lower(trim(exercise_name)) = 'closed eyed finishing (fun way to end workout)';

create temporary table retired_closed_eyed_exercises on commit drop as
select id, day_id
from public.workout_exercises
where video_clip_id in (select id from retired_closed_eyed_clips);

update public.workout_days
set active_exercise_id = null
where active_exercise_id in (select id from retired_closed_eyed_exercises);

delete from public.workout_edit_revisions revision
where revision.id in (
  select operation.revision_id
  from public.workout_edit_operations operation
  where operation.exercise_id in (select id from retired_closed_eyed_exercises)
)
or revision.before_snapshot::text ilike '%Closed Eyed Finishing (Fun Way to end workout)%'
or revision.after_snapshot::text ilike '%Closed Eyed Finishing (Fun Way to end workout)%';

delete from public.workout_exercises
where id in (select id from retired_closed_eyed_exercises);

with ordered_exercises as (
  select
    id,
    row_number() over (partition by day_id order by order_index, id) - 1 as next_order_index
  from public.workout_exercises
)
update public.workout_exercises exercise
set order_index = ordered_exercises.next_order_index
from ordered_exercises
where exercise.id = ordered_exercises.id;

update public.workout_days day
set estimated_minutes = greatest(
  5,
  round(
    coalesce((
      select sum(
        coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::int, 1) *
        coalesce(
          nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
          3
        )
      ) + 5 + count(*) * 1.5
      from public.workout_exercises exercise
      where exercise.day_id = day.id
    ), 5)
  )::integer
)
where day.id in (select distinct day_id from retired_closed_eyed_exercises);

delete from public.exercise_video_clips
where id in (select id from retired_closed_eyed_clips);
