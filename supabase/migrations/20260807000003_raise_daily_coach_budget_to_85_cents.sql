-- The active coach ledger and session bootstrap functions each embed the
-- daily budget. Recreate their deployed definitions with the new limit.
do $$
declare
  target regprocedure;
  definition text;
begin
  foreach target in array array[
    'public.get_my_coach_daily_usage()'::regprocedure,
    'public.bootstrap_coach_agent_session(uuid,uuid,text,text,text,text,integer)'::regprocedure,
    'public.record_coach_provider_metric(uuid,uuid,uuid,uuid,text,text,text,numeric,text,numeric,jsonb)'::regprocedure
  ]
  loop
    definition := replace(pg_get_functiondef(target), '0.75', '0.85');
    execute definition;
  end loop;
end;
$$;
