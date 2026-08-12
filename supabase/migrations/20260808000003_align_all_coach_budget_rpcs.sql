-- A prior budget increase updated the read/bootstrap/provider-metric RPCs but
-- left legacy session, usage, and TTS reservation RPCs at 75 cents. Recreate
-- every active definition from PostgreSQL's deployed source with the single
-- 85-cent daily policy, so reopening a Coach session cannot appear to refill
-- credit that another endpoint already exhausted.
do $$
declare
  target regprocedure;
  definition text;
begin
  foreach target in array array[
    'public.reserve_coach_session_usage(uuid,text,uuid,text,numeric)'::regprocedure,
    'public.record_coach_usage(uuid,text,uuid,text,integer,integer,integer,integer,integer,integer,integer,numeric)'::regprocedure,
    'public.reserve_coach_tts_usage(uuid,text,text,text,integer,text,text,numeric,integer,integer)'::regprocedure
  ]
  loop
    definition := replace(pg_get_functiondef(target), '0.75', '0.85');
    execute definition;
  end loop;
end;
$$;
