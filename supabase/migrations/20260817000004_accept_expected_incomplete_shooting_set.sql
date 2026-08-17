-- The workout context deliberately skips a completed active set and exposes
-- the next incomplete set. The atomic save previously compared against the
-- raw workout_days cursor first, so a cursor left on completed set 1 rejected
-- every valid result for set 2 as stale and could never repair itself.
--
-- A shooting save already proves that its requested set belongs to this user
-- and day, matches the client's expected set, and is still incomplete. Those
-- checks are the authoritative concurrency boundary. Do not reject that valid
-- set merely because workout_days still points at a completed predecessor.
do $$
declare
  v_definition text;
  v_old text := E'  if v_day.active_exercise_id is distinct from p_expected_exercise_id\n    or v_day.active_set_number is distinct from p_expected_set_number\n    or p_exercise_id is distinct from p_expected_exercise_id\n    or p_set_number is distinct from p_expected_set_number then';
  v_new text := E'  if p_exercise_id is distinct from p_expected_exercise_id\n    or p_set_number is distinct from p_expected_set_number then';
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate atomic shooting raw-cursor guard';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
