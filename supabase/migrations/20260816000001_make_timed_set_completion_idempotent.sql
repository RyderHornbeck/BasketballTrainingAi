-- Timer-expiry writes can be retried after a dropped response, app restart, or
-- connectivity loss. Treat the same completed set as a successful no-op so a
-- retry cannot advance session state or overwrite newer workout data.
create or replace function public.complete_my_timed_set_v3(
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
  v_already_completed boolean := false;
  v_state_version integer := 0;
  v_notes text;
  v_meta jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select log.notes
  into v_notes
  from public.exercise_logs log
  where log.exercise_id = p_exercise_id
    and log.day_id = p_day_id
    and log.user_id = v_user_id
    and log.notes like '__hoop_set_logs__:%'
  limit 1;

  if v_notes is not null then
    begin
      v_meta := substring(v_notes from length('__hoop_set_logs__:') + 1)::jsonb;
    exception when others then
      v_meta := '{}'::jsonb;
    end;
    v_already_completed := coalesce(
      (v_meta->'set_logs') @> jsonb_build_array(
        jsonb_build_object('set_number', p_set_number, 'completed', true)
      ),
      false
    );
  end if;

  if v_already_completed then
    select coalesce(max(session.state_version), 0)
    into v_state_version
    from public.coach_sessions session
    where session.user_id = v_user_id
      and session.day_id = p_day_id
      and session.ended_at is null
      and session.expires_at > clock_timestamp();

    return query
    select day.active_exercise_id, day.active_set_number, v_state_version
    from public.workout_days day
    where day.id = p_day_id and day.user_id = v_user_id;
    return;
  end if;

  return query
  select *
  from public.complete_my_timed_set_v2(
    p_day_id,
    p_exercise_id,
    p_set_number,
    p_duration_seconds
  );
end;
$$;

revoke all on function public.complete_my_timed_set_v3(uuid, uuid, integer, integer) from public;
grant execute on function public.complete_my_timed_set_v3(uuid, uuid, integer, integer) to authenticated;
