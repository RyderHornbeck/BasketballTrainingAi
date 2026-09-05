-- Bilateral sets always begin on the right, then alternate left/right.
-- Preserve each workout's number of sets and only change their labels.
update public.workout_exercises as exercise
set set_side_labels = array(
  select case
    when set_number % 2 = 1 then 'right side'
    else 'left side'
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
  and clip.requires_both_sides = true;

-- Enforce the same sequence for every future manual or Coach edit. This
-- includes an append after a middle set has been removed.
create or replace function public.normalize_bilateral_set_side_labels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requires_both_sides boolean;
  v_count integer;
begin
  select requires_both_sides into v_requires_both_sides
  from public.exercise_video_clips
  where id = new.video_clip_id;

  if coalesce(v_requires_both_sides, false) then
    v_count := greatest(
      1,
      coalesce(
        nullif(regexp_replace(coalesce(new.sets, ''), '[^0-9]', '', 'g'), '')::integer,
        1
      )
    );
    new.set_side_labels := array(
      select case when set_number % 2 = 1 then 'right side' else 'left side' end
      from generate_series(1, v_count) as set_number
    );
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_bilateral_set_side_labels_on_write
  on public.workout_exercises;
create trigger normalize_bilateral_set_side_labels_on_write
before insert or update of video_clip_id, sets, set_side_labels
on public.workout_exercises
for each row execute function public.normalize_bilateral_set_side_labels();
