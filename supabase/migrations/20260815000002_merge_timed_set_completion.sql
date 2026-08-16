-- Merge timer expiry into the latest persisted set metadata while holding the
-- exercise log lock. Client-prefetched snapshots must never replace newer set
-- results. Advance active Coach sessions in the same transaction so stale
-- turns can be rejected before they overwrite the refreshed client snapshot.
create or replace function public.complete_my_timed_set_v2(
  p_day_id uuid,
  p_exercise_id uuid,
  p_set_number integer,
  p_duration_seconds integer
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
  v_exercise public.workout_exercises%rowtype;
  v_log public.exercise_logs%rowtype;
  v_set_count integer;
  v_meta jsonb := '{}'::jsonb;
  v_existing_sets jsonb := '[]'::jsonb;
  v_set_logs jsonb;
  v_next_active_set integer;
  v_completed boolean;
  v_minutes_completed numeric;
  v_notes text;
  v_state_version integer := 0;
  v_prefix constant text := '__hoop_set_logs__:';
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_set_number < 1 then
    raise exception 'Set number must be positive';
  end if;
  if p_duration_seconds < 1 or p_duration_seconds > 86400 then
    raise exception 'Duration must be between 1 and 86400 seconds';
  end if;

  perform 1
  from public.workout_days
  where id = p_day_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'Workout day was not found';
  end if;

  select exercise.*
  into v_exercise
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id
    and exercise.day_id = p_day_id
    and exercise.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Workout exercise was not found';
  end if;

  v_set_count := greatest(
    1,
    coalesce(nullif(substring(coalesce(v_exercise.sets, '') from '^[0-9]+'), '')::integer, 1)
  );
  if p_set_number > v_set_count then
    raise exception 'Set number exceeds exercise set count';
  end if;

  select log.*
  into v_log
  from public.exercise_logs log
  where log.exercise_id = p_exercise_id
    and log.user_id = v_user_id
  for update;

  if found and v_log.notes like v_prefix || '%' then
    begin
      v_meta := substring(v_log.notes from length(v_prefix) + 1)::jsonb;
    exception when others then
      v_meta := jsonb_build_object('user_notes', v_log.notes);
    end;
  elsif found and nullif(btrim(v_log.notes), '') is not null then
    v_meta := jsonb_build_object('user_notes', v_log.notes);
  end if;

  if jsonb_typeof(v_meta->'set_logs') = 'array' then
    v_existing_sets := v_meta->'set_logs';
  end if;

  select jsonb_agg(
    case
      when set_number = p_set_number then
        base_row || jsonb_build_object(
          'set_number', set_number,
          'completed', true,
          'force_incomplete', false,
          'duration_seconds_override', p_duration_seconds,
          'minutes', p_duration_seconds::numeric / 60
        )
      else base_row || jsonb_build_object('set_number', set_number)
    end
    order by set_number
  )
  into v_set_logs
  from (
    select
      generated.set_number,
      coalesce(
        (
          select saved.value
          from jsonb_array_elements(v_existing_sets) saved(value)
          where (saved.value->>'set_number')::integer = generated.set_number
          limit 1
        ),
        jsonb_build_object(
          'set_number', generated.set_number,
          'completed', false,
          'makes', null,
          'attempts', v_exercise.target_attempts,
          'minutes', null
        )
      ) as base_row
    from generate_series(1, v_set_count) generated(set_number)
  ) merged;

  select min((entry->>'set_number')::integer)
  into v_next_active_set
  from jsonb_array_elements(v_set_logs) entry
  where not coalesce((entry->>'completed')::boolean, false);

  v_completed := v_next_active_set is null;
  select nullif(sum((entry->>'minutes')::numeric), 0)
  into v_minutes_completed
  from jsonb_array_elements(v_set_logs) entry
  where nullif(entry->>'minutes', '') is not null;

  v_meta := jsonb_set(v_meta, '{set_logs}', v_set_logs, true);
  v_notes := v_prefix || v_meta::text;

  insert into public.exercise_logs (
    exercise_id,
    day_id,
    user_id,
    completed,
    makes,
    attempts,
    minutes_completed,
    difficulty,
    notes
  )
  values (
    p_exercise_id,
    p_day_id,
    v_user_id,
    v_completed,
    v_log.makes,
    v_log.attempts,
    v_minutes_completed,
    v_log.difficulty,
    v_notes
  )
  on conflict (exercise_id) do update
  set
    completed = excluded.completed,
    minutes_completed = excluded.minutes_completed,
    notes = excluded.notes;

  update public.workout_days
  set
    active_exercise_id = p_exercise_id,
    active_set_number = v_next_active_set
  where id = p_day_id and user_id = v_user_id;

  with advanced as (
    update public.coach_sessions
    set
      state_version = state_version + 1,
      refreshed_at = clock_timestamp()
    where user_id = v_user_id
      and day_id = p_day_id
      and ended_at is null
      and expires_at > clock_timestamp()
    returning state_version
  )
  select coalesce(max(advanced.state_version), 0)
  into v_state_version
  from advanced;

  return query
  select day.active_exercise_id, day.active_set_number, v_state_version
  from public.workout_days day
  where day.id = p_day_id and day.user_id = v_user_id;
end;
$$;

revoke all on function public.complete_my_timed_set_v2(
  uuid, uuid, integer, integer
) from public;
grant execute on function public.complete_my_timed_set_v2(
  uuid, uuid, integer, integer
) to authenticated;
