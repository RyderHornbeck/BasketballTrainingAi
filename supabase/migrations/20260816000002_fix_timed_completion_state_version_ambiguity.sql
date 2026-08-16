-- `RETURNS TABLE (... state_version ...)` creates a PL/pgSQL output variable
-- named state_version. The original v2 RPC used an unqualified
-- `state_version = state_version + 1` inside its coach_sessions update, so
-- PostgreSQL could not distinguish the output variable from the table column.
-- Recompile the already-deployed function with qualified column references.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.complete_my_timed_set_v2(uuid,uuid,integer,integer)'::regprocedure
  )
  into v_definition;

  v_definition := regexp_replace(
    v_definition,
    '\mstate_version\s*=\s*state_version\s*\+\s*1',
    'state_version = coach_sessions.state_version + 1',
    'g'
  );
  v_definition := regexp_replace(
    v_definition,
    '\mreturning\s+state_version',
    'returning coach_sessions.state_version',
    'g'
  );

  execute v_definition;
end;
$$;
