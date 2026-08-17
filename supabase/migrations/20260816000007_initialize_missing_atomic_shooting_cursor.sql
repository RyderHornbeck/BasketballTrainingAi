-- Older workout days can legitimately have no persisted active cursor: Coach
-- derives their first incomplete set from the workout context. The atomic
-- shooting RPC previously treated that bootstrap state as a stale conflict,
-- so it rejected the first save while the client had already advanced locally.
-- Initialize only the fully missing legacy cursor from the caller's expected
-- current set. A partially populated or conflicting cursor remains stale.
do $$
declare
  v_definition text;
  v_old text := E'  -- A normal make/miss must target the cursor the client believes it is on.\n  -- Returning the current cursor is safer than allowing a stale cumulative\n  -- total to modify an already-finished set.\n  if v_day.active_exercise_id is distinct from p_expected_exercise_id\n    or v_day.active_set_number is distinct from p_expected_set_number\n    or p_exercise_id is distinct from p_expected_exercise_id\n    or p_set_number is distinct from p_expected_set_number then';
  v_new text := E'  -- Legacy days created before active-set persistence have a fully\n  -- missing cursor. Bootstrap that cursor from this exact expected current\n  -- set, then enforce the normal compare-and-swap rule below.\n  if v_day.active_exercise_id is null and v_day.active_set_number is null then\n    update public.workout_days day\n    set active_exercise_id = p_expected_exercise_id,\n        active_set_number = p_expected_set_number\n    where day.id = p_day_id and day.user_id = p_user_id\n    returning * into v_day;\n  end if;\n\n  -- A normal make/miss must target the cursor the client believes it is on.\n  -- Returning the current cursor is safer than allowing a stale cumulative\n  -- total to modify an already-finished set.\n  if v_day.active_exercise_id is distinct from p_expected_exercise_id\n    or v_day.active_set_number is distinct from p_expected_set_number\n    or p_exercise_id is distinct from p_expected_exercise_id\n    or p_set_number is distinct from p_expected_set_number then';
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate atomic shooting cursor check for bootstrap patch';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
