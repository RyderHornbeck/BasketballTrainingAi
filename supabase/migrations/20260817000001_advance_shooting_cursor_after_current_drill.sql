-- A skipped drill must stay skipped until the athlete completes the drills
-- after it. The atomic shooting RPC previously selected the globally first
-- incomplete drill, which overwrote the client's forward/circular cursor.
do $$
declare
  v_definition text;
  v_old text := E'      select exercise.id into v_next_exercise_id\n      from public.workout_exercises exercise\n      left join public.exercise_logs log\n        on log.exercise_id = exercise.id and log.user_id = p_user_id\n      where exercise.day_id = p_day_id\n        and exercise.user_id = p_user_id\n        and coalesce(log.completed, false) = false\n      order by\n        case exercise.category\n          when ''warmup'' then 0 when ''mobility'' then 1 when ''ball_handling'' then 2\n          when ''shooting'' then 3 when ''finishing'' then 4 when ''defense'' then 5\n          when ''conditioning'' then 6 when ''footwork'' then 7 when ''strength'' then 8\n          when ''basketball_iq'' then 9 else 999 end,\n        exercise.order_index nulls last,\n        exercise.id\n      limit 1;';
  v_new text := E'      with ordered as (\n        select\n          exercise.id,\n          coalesce(log.completed, false) as completed,\n          row_number() over (\n            order by\n              case exercise.category\n                when ''warmup'' then 0 when ''mobility'' then 1 when ''ball_handling'' then 2\n                when ''shooting'' then 3 when ''finishing'' then 4 when ''defense'' then 5\n                when ''conditioning'' then 6 when ''footwork'' then 7 when ''strength'' then 8\n                when ''basketball_iq'' then 9 else 999 end,\n              exercise.order_index nulls last,\n              exercise.id\n          ) as position\n        from public.workout_exercises exercise\n        left join public.exercise_logs log\n          on log.exercise_id = exercise.id and log.user_id = p_user_id\n        where exercise.day_id = p_day_id and exercise.user_id = p_user_id\n      ), current_position as (\n        select position from ordered where id = p_exercise_id\n      )\n      select ordered.id into v_next_exercise_id\n      from ordered\n      cross join current_position\n      where not ordered.completed\n      order by\n        case when ordered.position > current_position.position then 0 else 1 end,\n        ordered.position\n      limit 1;';
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate atomic shooting next-drill selection for circular-order patch';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
