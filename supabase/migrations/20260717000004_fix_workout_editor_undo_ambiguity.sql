create or replace function public.undo_workout_edit_revision(
  p_user_id uuid,
  p_day_id uuid
)
returns table (
  revision_id uuid,
  changes jsonb,
  can_undo boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  revision public.workout_edit_revisions%rowtype;
  operation public.workout_edit_operations%rowtype;
begin
  select *
  into revision
  from public.workout_edit_revisions
  where user_id = p_user_id
    and day_id = p_day_id
    and undone_at is null
  order by applied_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  for operation in
    select operation_row.*
    from public.workout_edit_operations operation_row
    where operation_row.revision_id = revision.id
    order by operation_row.operation_index desc
  loop
    if operation.operation_type = 'add' then
      delete from public.workout_exercises
      where id = operation.exercise_id
        and day_id = revision.day_id
        and user_id = revision.user_id;
    elsif operation.operation_type = 'remove' and operation.exercise_snapshot is not null then
      insert into public.workout_exercises
      select (jsonb_populate_record(null::public.workout_exercises, operation.exercise_snapshot)).*
      on conflict (id) do nothing;

      if operation.exercise_log_snapshot is not null then
        insert into public.exercise_logs
        select (jsonb_populate_record(null::public.exercise_logs, operation.exercise_log_snapshot)).*
        on conflict (exercise_id) do update
        set
          day_id = excluded.day_id,
          user_id = excluded.user_id,
          completed = excluded.completed,
          makes = excluded.makes,
          attempts = excluded.attempts,
          minutes_completed = excluded.minutes_completed,
          difficulty = excluded.difficulty,
          notes = excluded.notes;
      end if;
    end if;
  end loop;

  update public.workout_days
  set
    active_exercise_id = coalesce(
      active_exercise_id,
      nullif(revision.before_snapshot ->> 'active_exercise_id', '')::uuid
    ),
    estimated_minutes = greatest(
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
          where exercise.day_id = revision.day_id
            and exercise.user_id = revision.user_id
        ), 5)
      )::integer
    )
  where id = revision.day_id
    and user_id = revision.user_id;

  update public.workout_edit_revisions
  set undone_at = now()
  where id = revision.id;

  revision_id := revision.id;
  changes := revision.changes;
  select exists(
    select 1
    from public.workout_edit_revisions candidate
    where candidate.user_id = revision.user_id
      and candidate.day_id = revision.day_id
      and candidate.undone_at is null
  )
  into can_undo;
  return next;
end;
$$;

notify pgrst, 'reload schema';
