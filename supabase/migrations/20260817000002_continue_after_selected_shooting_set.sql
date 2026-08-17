-- Completing an explicitly selected later set must continue forward through
-- the workout before wrapping to earlier skipped sets in the same drill.
do $$
declare
  v_definition text;
  v_old text := E'    from jsonb_array_elements(v_updated_entries) entry\n    where not coalesce((entry->>''completed'')::boolean, false);';
  v_new text := E'    from jsonb_array_elements(v_updated_entries) entry\n    where not coalesce((entry->>''completed'')::boolean, false)\n      and (entry->>''set_number'')::integer > p_set_number;';
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate atomic shooting same-drill cursor selection';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
