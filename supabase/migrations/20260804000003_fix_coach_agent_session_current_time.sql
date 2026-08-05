-- `current_time` is a PostgreSQL keyword. The original PL/pgSQL variable was
-- parsed as a time-with-time-zone expression, so casting it to date failed.
create or replace function public.bootstrap_coach_agent_session(
  p_user_id uuid,
  p_day_id uuid,
  p_session_key text,
  p_provider text,
  p_model text,
  p_voice_persona text,
  p_state_version integer default 0
)
returns table (
  session_id uuid,
  started_at timestamptz,
  refreshed_at timestamptz,
  expires_at timestamptz,
  state_version integer,
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric,
  allowed boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_session public.coach_sessions%rowtype;
  active_session public.coach_sessions%rowtype;
  local_timezone text := 'UTC';
  local_date date;
  current_spent numeric := 0;
  daily_budget constant numeric := 0.75;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null
    or p_day_id is null
    or p_session_key is null
    or length(p_session_key) not between 16 and 128
    or p_provider is null
    or length(p_provider) not between 1 and 40
    or p_voice_persona is null
    or p_voice_persona not in ('tyler', 'devin', 'maya', 'ava')
    or coalesce(p_state_version, 0) not between 0 and 1000000
  then
    raise exception 'Invalid coach agent session bootstrap';
  end if;

  if not exists (
    select 1 from public.workout_days day
    where day.id = p_day_id and day.user_id = p_user_id
  ) then
    return query select null::uuid, null::timestamptz, null::timestamptz,
      null::timestamptz, 0, 0::numeric, daily_budget, daily_budget, false,
      'workout_day_not_found'::text;
    return;
  end if;

  select session.* into existing_session
  from public.coach_sessions session
  where session.session_key = p_session_key
  for update;

  if found and (
    existing_session.user_id <> p_user_id
    or existing_session.day_id <> p_day_id
  ) then
    return query select existing_session.id, existing_session.started_at,
      existing_session.refreshed_at, existing_session.expires_at,
      existing_session.state_version, 0::numeric, daily_budget, 0::numeric,
      false, 'session_key_conflict'::text;
    return;
  end if;

  select profile.timezone into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1 from pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (v_now at time zone local_timezone)::date;

  insert into public.coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict on constraint coach_daily_usage_pkey do nothing;

  select usage.spent_usd into current_spent
  from public.coach_daily_usage usage
  where usage.user_id = p_user_id and usage.usage_date = local_date
  for update;

  if current_spent >= daily_budget then
    return query select
      case when existing_session.id is null then null else existing_session.id end,
      existing_session.started_at, existing_session.refreshed_at,
      existing_session.expires_at, coalesce(existing_session.state_version, 0),
      current_spent, daily_budget, 0::numeric, false,
      'daily_budget_exhausted'::text;
    return;
  end if;

  if existing_session.id is null then
    insert into public.coach_sessions (
      user_id, day_id, session_key, model, provider, voice_persona,
      state_version, started_at, refreshed_at, expires_at, ended_at
    ) values (
      p_user_id, p_day_id, p_session_key, p_model, p_provider, p_voice_persona,
      coalesce(p_state_version, 0), v_now, v_now,
      v_now + interval '24 hours', null
    )
    returning * into active_session;
  else
    update public.coach_sessions session
    set model = p_model,
        provider = p_provider,
        voice_persona = p_voice_persona,
        state_version = greatest(session.state_version, coalesce(p_state_version, 0)),
        started_at = case
          when session.ended_at is not null or session.expires_at <= v_now
            then v_now
          else session.started_at
        end,
        refreshed_at = v_now,
        expires_at = v_now + interval '24 hours',
        ended_at = null
    where session.id = existing_session.id
    returning * into active_session;
  end if;

  insert into public.coach_session_events (
    session_id, user_id, day_id, provider, event_type, details
  ) values (
    active_session.id, p_user_id, p_day_id, p_provider,
    case when existing_session.id is null then 'bootstrap_created' else 'bootstrap_refreshed' end,
    jsonb_build_object(
      'state_version', active_session.state_version,
      'voice_persona', p_voice_persona
    )
  );

  return query select active_session.id, active_session.started_at,
    active_session.refreshed_at, active_session.expires_at,
    active_session.state_version, current_spent, daily_budget,
    greatest(0, daily_budget - current_spent), true, null::text;
end;
$$;

revoke all on function public.bootstrap_coach_agent_session(
  uuid, uuid, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.bootstrap_coach_agent_session(
  uuid, uuid, text, text, text, text, integer
) to service_role;
