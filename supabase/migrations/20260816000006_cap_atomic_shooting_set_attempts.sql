-- A delayed or multi-shot voice result must not leave a set above its
-- prescribed attempt limit. Clamp inside the transaction as the final
-- authority; the client applies the same rule for immediate feedback.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  v_definition := replace(
    v_definition,
    E'  v_target_attempts := coalesce(\n    nullif(v_entry->>''target_attempts_override'', '''')::integer,\n    v_target_attempts\n  );',
    E'  v_target_attempts := coalesce(\n    nullif(v_entry->>''target_attempts_override'', '''')::integer,\n    v_target_attempts\n  );\n  if v_target_attempts > 0 then\n    p_attempts := least(p_attempts, v_target_attempts);\n    p_makes := least(p_makes, p_attempts);\n  end if;'
  );
  if position('p_attempts := least(p_attempts, v_target_attempts)' in v_definition) = 0 then
    raise exception 'Could not install atomic shooting attempt cap';
  end if;
  execute v_definition;
end;
$$;
