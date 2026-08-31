-- Keep all established usage-reservation paths on the same $1 daily limit.
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
    definition := replace(pg_get_functiondef(target), '0.85', '1.0');
    execute definition;
  end loop;
end;
$$;
