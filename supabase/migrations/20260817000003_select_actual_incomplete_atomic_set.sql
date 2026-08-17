-- The circular drill selector can wrap to an exercise whose first set is
-- already complete. Choose that exercise's actual first incomplete set rather
-- than blindly reinstalling set 1 as the workout cursor.
do $$
declare
  v_definition text;
  v_old text := E'      v_next_set_number := 1;';
  v_new text := E'      if v_next_exercise_id = p_exercise_id then\n        select min((entry->>''set_number'')::integer)\n        into v_next_set_number\n        from jsonb_array_elements(v_updated_entries) entry\n        where not coalesce((entry->>''completed'')::boolean, false);\n      else\n        select min(candidate.set_number)\n        into v_next_set_number\n        from (\n          select\n            number as set_number,\n            coalesce((\n              select (entry->>''completed'')::boolean\n              from jsonb_array_elements(\n                case\n                  when log.notes like ''__hoop_set_logs__:%'' then\n                    coalesce(\n                      (substring(log.notes from length(''__hoop_set_logs__:'') + 1)::jsonb)->''set_logs'',\n                      ''[]''::jsonb\n                    )\n                  else ''[]''::jsonb\n                end\n              ) entry\n              where (entry->>''set_number'')::integer = number\n              limit 1\n            ), false) as completed\n          from public.workout_exercises exercise\n          left join public.exercise_logs log\n            on log.exercise_id = exercise.id and log.user_id = p_user_id\n          cross join lateral generate_series(\n            1,\n            greatest(\n              1,\n              coalesce(\n                nullif(regexp_replace(coalesce(exercise.sets, ''1''), ''\\D.*$'', ''''), '''')::integer,\n                1\n              )\n            )\n          ) number\n          where exercise.id = v_next_exercise_id\n            and exercise.day_id = p_day_id\n            and exercise.user_id = p_user_id\n        ) candidate\n        where not candidate.completed;\n      end if;';
begin
  select pg_get_functiondef(
    'public.apply_coach_shooting_set_result_v2(uuid,uuid,uuid,integer,integer,integer,uuid,integer)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate atomic shooting default next-set assignment';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;
