-- Parenthetical labels are metadata, not part of the athlete-facing drill name.
do $$
declare
  target record;
begin
  for target in
    select
      exercise_name as old_name,
      trim(regexp_replace(exercise_name, '\s*\([^)]*\)', '', 'g')) as new_name
    from public.exercise_video_clips
    where exercise_name ~ '\([^)]*\)'
  loop
    update public.exercise_video_clips
    set exercise_name = target.new_name
    where exercise_name = target.old_name;

    update public.workout_exercises
    set name = target.new_name
    where name = target.old_name;

    update public.workout_edit_operations
    set exercise_snapshot = replace(
      exercise_snapshot::text,
      target.old_name,
      target.new_name
    )::jsonb
    where exercise_snapshot::text like '%' || target.old_name || '%';

    update public.workout_edit_revisions
    set before_snapshot = replace(
          before_snapshot::text,
          target.old_name,
          target.new_name
        )::jsonb,
        after_snapshot = replace(
          after_snapshot::text,
          target.old_name,
          target.new_name
        )::jsonb
    where before_snapshot::text like '%' || target.old_name || '%'
       or after_snapshot::text like '%' || target.old_name || '%';
  end loop;
end;
$$;
