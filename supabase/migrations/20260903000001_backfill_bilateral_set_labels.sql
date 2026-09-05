-- Keep every bilateral catalog drill and existing workout in agreement.
-- Existing workouts may predate the side-label feature, so their labels must
-- be restored from the catalog without changing results or targets.
update public.exercise_video_clips
set requires_both_sides = true
where lower(exercise_name) in (
  'floaters',
  'spin move layup',
  'slide by layup'
);

update public.workout_exercises as exercise
set set_side_labels = array(
  select case
    when set_number % 2 = 1 then 'left side'
    else 'right side'
  end
  from generate_series(
    1,
    greatest(
      1,
      coalesce(
        nullif(regexp_replace(coalesce(exercise.sets, ''), '[^0-9]', '', 'g'), '')::integer,
        1
      )
    )
  ) as set_number
)
from public.exercise_video_clips as clip
where exercise.video_clip_id = clip.id
  and clip.requires_both_sides = true
  and (
    exercise.set_side_labels is null
    or cardinality(exercise.set_side_labels) <> greatest(
      1,
      coalesce(
        nullif(regexp_replace(coalesce(exercise.sets, ''), '[^0-9]', '', 'g'), '')::integer,
        1
      )
    )
  );
