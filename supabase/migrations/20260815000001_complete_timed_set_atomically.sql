-- Timer expiry must never leave completed set logs and the active cursor out
-- of sync. Keep both writes in one transaction under the authenticated user.
create or replace function public.complete_my_timed_set(
  p_day_id uuid,
  p_exercise_id uuid,
  p_completed boolean,
  p_makes integer,
  p_attempts integer,
  p_minutes_completed numeric,
  p_difficulty integer,
  p_notes text,
  p_next_active_set integer
)
returns table(active_exercise_id uuid, active_set_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.workout_days
  where id = p_day_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Workout day was not found';
  end if;

  perform 1
  from public.workout_exercises
  where id = p_exercise_id and day_id = p_day_id and user_id = v_user_id;
  if not found then
    raise exception 'Workout exercise was not found';
  end if;

  insert into public.exercise_logs (
    exercise_id, day_id, user_id, completed, makes, attempts,
    minutes_completed, difficulty, notes
  )
  values (
    p_exercise_id, p_day_id, v_user_id, p_completed, p_makes, p_attempts,
    p_minutes_completed, p_difficulty, p_notes
  )
  on conflict (exercise_id) do update
  set
    completed = excluded.completed,
    makes = excluded.makes,
    attempts = excluded.attempts,
    minutes_completed = excluded.minutes_completed,
    difficulty = excluded.difficulty,
    notes = excluded.notes;

  update public.workout_days
  set
    active_exercise_id = p_exercise_id,
    active_set_number = p_next_active_set
  where id = p_day_id and user_id = v_user_id;

  return query
  select day.active_exercise_id, day.active_set_number
  from public.workout_days day
  where day.id = p_day_id and day.user_id = v_user_id;
end;
$$;

revoke all on function public.complete_my_timed_set(
  uuid, uuid, boolean, integer, integer, numeric, integer, text, integer
) from public;
grant execute on function public.complete_my_timed_set(
  uuid, uuid, boolean, integer, integer, numeric, integer, text, integer
) to authenticated;
