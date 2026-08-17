-- A shooting completion previously wrote exercise_logs, workout_days, and
-- coach_sessions in separate requests. Keep the active set transition and its
-- version in one transaction so a delayed shot can never overwrite it.
create or replace function public.apply_coach_shooting_set_result_v2(
  p_user_id uuid,
  p_day_id uuid,
  p_exercise_id uuid,
  p_set_number integer,
  p_makes integer,
  p_attempts integer,
  p_expected_exercise_id uuid,
  p_expected_set_number integer
)
returns table(
  status text,
  active_exercise_id uuid,
  active_set_number integer,
  saved_set_completed boolean,
  saved_set_makes integer,
  saved_set_attempts integer,
  state_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.workout_days%rowtype;
  v_exercise public.workout_exercises%rowtype;
  v_log public.exercise_logs%rowtype;
  v_meta jsonb := '{}'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_updated_entries jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_updated_entry jsonb;
  v_set_count integer;
  v_target_attempts integer;
  v_set_completed boolean;
  v_drill_completed boolean;
  v_total_makes integer;
  v_total_attempts integer;
  v_next_exercise_id uuid;
  v_next_set_number integer;
  v_state_version integer := 0;
  v_notes text;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;
  if p_makes < 0 or p_attempts < 0 or p_makes > p_attempts then
    raise exception 'Invalid shooting result';
  end if;

  select * into v_day
  from public.workout_days day
  where day.id = p_day_id and day.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Workout day was not found';
  end if;

  select * into v_exercise
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id
    and exercise.day_id = p_day_id
    and exercise.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Workout exercise was not found';
  end if;
  if v_exercise.category not in ('shooting', 'finishing') then
    raise exception 'Exercise is not a shooting or finishing drill';
  end if;

  -- A normal make/miss must target the cursor the client believes it is on.
  -- Returning the current cursor is safer than allowing a stale cumulative
  -- total to modify an already-finished set.
  if v_day.active_exercise_id is distinct from p_expected_exercise_id
    or v_day.active_set_number is distinct from p_expected_set_number
    or p_exercise_id is distinct from p_expected_exercise_id
    or p_set_number is distinct from p_expected_set_number then
    return query select
      'stale'::text,
      v_day.active_exercise_id,
      v_day.active_set_number,
      false,
      null::integer,
      null::integer,
      0;
    return;
  end if;

  select * into v_log
  from public.exercise_logs log
  where log.exercise_id = p_exercise_id and log.user_id = p_user_id
  for update;

  if found and v_log.notes like '__hoop_set_logs__:%' then
    begin
      v_meta := substring(v_log.notes from length('__hoop_set_logs__:') + 1)::jsonb;
    exception when others then
      v_meta := jsonb_build_object('user_notes', v_log.notes);
    end;
  elsif found and v_log.notes is not null then
    v_meta := jsonb_build_object('user_notes', v_log.notes);
  end if;

  v_set_count := greatest(1, coalesce(nullif(regexp_replace(coalesce(v_exercise.sets, '1'), '\D.*$', ''), '')::integer, 1));
  if p_set_number < 1 or p_set_number > v_set_count then
    raise exception 'Invalid set number';
  end if;
  v_target_attempts := coalesce(v_exercise.target_attempts, v_exercise.target_makes, 0);

  select coalesce(jsonb_agg(
    coalesce(
      (
        select entry
        from jsonb_array_elements(coalesce(v_meta->'set_logs', '[]'::jsonb)) entry
        where (entry->>'set_number')::integer = number
        limit 1
      ),
      jsonb_build_object(
        'set_number', number,
        'completed', false,
        'makes', null,
        'attempts', v_target_attempts,
        'minutes', null
      )
    )
  order by number), '[]'::jsonb)
  into v_entries
  from generate_series(1, v_set_count) number;

  select entry into v_entry
  from jsonb_array_elements(v_entries) entry
  where (entry->>'set_number')::integer = p_set_number;
  v_target_attempts := coalesce(
    nullif(v_entry->>'target_attempts_override', '')::integer,
    v_target_attempts
  );
  if coalesce((v_entry->>'completed')::boolean, false) then
    return query select
      'stale'::text,
      v_day.active_exercise_id,
      v_day.active_set_number,
      true,
      coalesce((v_entry->>'makes')::integer, 0),
      coalesce((v_entry->>'attempts')::integer, 0),
      0;
    return;
  end if;

  v_set_completed := v_target_attempts > 0 and p_attempts >= v_target_attempts;
  select coalesce(jsonb_agg(
    case when (entry->>'set_number')::integer = p_set_number then
      (entry - 'force_incomplete') || jsonb_build_object(
        'set_number', p_set_number,
        'completed', v_set_completed,
        'makes', p_makes,
        'attempts', p_attempts
      )
    else entry end
  order by (entry->>'set_number')::integer), '[]'::jsonb)
  into v_updated_entries
  from jsonb_array_elements(v_entries) entry;

  select bool_and(coalesce((entry->>'completed')::boolean, false))
  into v_drill_completed
  from jsonb_array_elements(v_updated_entries) entry;
  select
    coalesce(sum(coalesce((entry->>'makes')::integer, 0))
      filter (where coalesce((entry->>'completed')::boolean, false)), 0),
    coalesce(sum(coalesce((entry->>'attempts')::integer, 0))
      filter (where coalesce((entry->>'completed')::boolean, false)), 0)
  into v_total_makes, v_total_attempts
  from jsonb_array_elements(v_updated_entries) entry;

  v_meta := jsonb_set(v_meta, '{set_logs}', v_updated_entries, true);
  v_notes := '__hoop_set_logs__:' || v_meta::text;
  insert into public.exercise_logs (
    exercise_id, day_id, user_id, completed, makes, attempts,
    minutes_completed, difficulty, notes
  )
  values (
    p_exercise_id, p_day_id, p_user_id, v_drill_completed,
    case when v_drill_completed then v_total_makes else null end,
    case when v_drill_completed then v_total_attempts else null end,
    v_log.minutes_completed,
    v_log.difficulty,
    v_notes
  )
  on conflict (exercise_id) do update set
    completed = excluded.completed,
    makes = excluded.makes,
    attempts = excluded.attempts,
    minutes_completed = excluded.minutes_completed,
    difficulty = excluded.difficulty,
    notes = excluded.notes;

  if v_set_completed then
    -- Continue within this drill first. Once it is complete, use the same
    -- category-first display order used by Court Coach's workout navigation.
    select min((entry->>'set_number')::integer)
    into v_next_set_number
    from jsonb_array_elements(v_updated_entries) entry
    where not coalesce((entry->>'completed')::boolean, false);
    if v_next_set_number is not null then
      v_next_exercise_id := p_exercise_id;
    else
      select exercise.id into v_next_exercise_id
      from public.workout_exercises exercise
      left join public.exercise_logs log
        on log.exercise_id = exercise.id and log.user_id = p_user_id
      where exercise.day_id = p_day_id
        and exercise.user_id = p_user_id
        and coalesce(log.completed, false) = false
      order by
        case exercise.category
          when 'warmup' then 0 when 'mobility' then 1 when 'ball_handling' then 2
          when 'shooting' then 3 when 'finishing' then 4 when 'defense' then 5
          when 'conditioning' then 6 when 'footwork' then 7 when 'strength' then 8
          when 'basketball_iq' then 9 else 999 end,
        exercise.order_index nulls last,
        exercise.id
      limit 1;
      v_next_set_number := 1;
    end if;
    update public.workout_days day set
      active_exercise_id = v_next_exercise_id,
      active_set_number = case when v_next_exercise_id is null then null else v_next_set_number end
    where day.id = p_day_id and day.user_id = p_user_id
    returning * into v_day;
  end if;

  with advanced as (
    update public.coach_sessions session
    set state_version = session.state_version + 1, refreshed_at = clock_timestamp()
    where session.user_id = p_user_id and session.day_id = p_day_id
      and session.ended_at is null and session.expires_at > clock_timestamp()
    returning session.state_version
  )
  select coalesce(max(advanced.state_version), 0) into v_state_version from advanced;

  return query select
    'applied'::text,
    v_day.active_exercise_id,
    v_day.active_set_number,
    v_set_completed,
    p_makes,
    p_attempts,
    v_state_version;
end;
$$;

revoke all on function public.apply_coach_shooting_set_result_v2(
  uuid, uuid, uuid, integer, integer, integer, uuid, integer
) from public;
grant execute on function public.apply_coach_shooting_set_result_v2(
  uuid, uuid, uuid, integer, integer, integer, uuid, integer
) to service_role;
