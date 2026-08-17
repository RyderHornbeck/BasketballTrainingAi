-- Manual workout-card edits previously wrote exercise_logs directly, leaving
-- Coach's selected drill/set and session versions stale. Persist the log and
-- reconcile that cursor in one server-authoritative operation.
create or replace function public.save_my_exercise_log_v2(
  p_day_id uuid,
  p_exercise_id uuid,
  p_completed boolean,
  p_makes integer,
  p_attempts integer,
  p_minutes_completed numeric,
  p_difficulty integer,
  p_notes text
)
returns table(
  active_exercise_id uuid,
  active_set_number integer,
  state_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_exercise record;
  v_log record;
  v_next_exercise_id uuid := null;
  v_next_set_number integer := null;
  v_meta jsonb := '{}'::jsonb;
  v_state_version integer := 0;
  v_prefix constant text := '__hoop_set_logs__:';
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.workout_days day
  where day.id = p_day_id and day.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Workout day was not found';
  end if;

  perform 1
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id
    and exercise.day_id = p_day_id
    and exercise.user_id = v_user_id;
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

  -- Select the first incomplete drill in persisted display order, then the
  -- first incomplete set from its normalized metadata. A malformed legacy
  -- note safely falls back to set 1 rather than blocking the workout.
  for v_exercise in
    select exercise.id
    from public.workout_exercises exercise
    left join public.exercise_logs log
      on log.exercise_id = exercise.id and log.user_id = v_user_id
    where exercise.day_id = p_day_id and exercise.user_id = v_user_id
      and coalesce(log.completed, false) = false
    order by exercise.order_index asc, exercise.id asc
  loop
    v_next_exercise_id := v_exercise.id;
    select log.notes into v_log
    from public.exercise_logs log
    where log.exercise_id = v_exercise.id and log.user_id = v_user_id;

    if v_log.notes like v_prefix || '%' then
      begin
        v_meta := substring(v_log.notes from length(v_prefix) + 1)::jsonb;
        select min((entry->>'set_number')::integer)
        into v_next_set_number
        from jsonb_array_elements(coalesce(v_meta->'set_logs', '[]'::jsonb)) entry
        where not coalesce((entry->>'completed')::boolean, false);
      exception when others then
        v_next_set_number := null;
      end;
    end if;
    v_next_set_number := coalesce(v_next_set_number, 1);
    exit;
  end loop;

  update public.workout_days day
  set
    active_exercise_id = v_next_exercise_id,
    active_set_number = v_next_set_number
  where day.id = p_day_id and day.user_id = v_user_id;

  with advanced as (
    update public.coach_sessions session
    set
      state_version = session.state_version + 1,
      refreshed_at = clock_timestamp()
    where session.user_id = v_user_id
      and session.day_id = p_day_id
      and session.ended_at is null
      and session.expires_at > clock_timestamp()
    returning session.state_version
  )
  select coalesce(max(advanced.state_version), 0)
  into v_state_version
  from advanced;

  return query
  select day.active_exercise_id, day.active_set_number, coalesce(v_state_version, 0)
  from public.workout_days day
  where day.id = p_day_id and day.user_id = v_user_id;
end;
$$;

revoke all on function public.save_my_exercise_log_v2(
  uuid, uuid, boolean, integer, integer, numeric, integer, text
) from public;
grant execute on function public.save_my_exercise_log_v2(
  uuid, uuid, boolean, integer, integer, numeric, integer, text
) to authenticated;
