alter table public.coach_agent_turns
  add column if not exists state_version integer not null default 0,
  add column if not exists state_fingerprint text,
  add column if not exists transcript text,
  add column if not exists model text,
  add column if not exists response_id text;

create or replace function public.advance_coach_session_state(
  p_session_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
begin
  update public.coach_sessions
  set state_version = state_version + 1,
      refreshed_at = clock_timestamp()
  where id = p_session_id
    and user_id = p_user_id
    and ended_at is null
    and expires_at > clock_timestamp()
  returning state_version into next_version;
  if next_version is null then
    raise exception 'Coach session is not active';
  end if;
  return next_version;
end;
$$;

revoke all on function public.advance_coach_session_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.advance_coach_session_state(uuid, uuid)
  to service_role;

create or replace function public.record_coach_provider_metric(
  p_user_id uuid,
  p_session_id uuid,
  p_day_id uuid,
  p_turn_id uuid,
  p_provider text,
  p_provider_request_id text,
  p_metric text,
  p_quantity numeric,
  p_unit text,
  p_estimated_cost_usd numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  recorded boolean,
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  local_timezone text := 'UTC';
  local_date date;
  inserted_id uuid;
  current_spent numeric := 0;
  daily_budget constant numeric := 0.75;
begin
  if p_quantity < 0
    or p_estimated_cost_usd < 0
    or p_estimated_cost_usd > 0.75
    or length(p_provider_request_id) not between 8 and 160
    or length(p_provider) not between 1 and 40
    or length(p_metric) not between 1 and 80
    or length(p_unit) not between 1 and 40
  then
    raise exception 'Invalid coach provider usage metric';
  end if;

  if not exists (
    select 1 from public.coach_sessions session
    where session.id = p_session_id
      and session.user_id = p_user_id
      and session.day_id = p_day_id
  ) then
    raise exception 'Coach session ownership mismatch';
  end if;

  insert into public.coach_provider_usage (
    session_id, turn_id, user_id, day_id, provider, provider_request_id,
    metric, quantity, unit, estimated_cost_usd, metadata
  ) values (
    p_session_id, p_turn_id, p_user_id, p_day_id, p_provider,
    p_provider_request_id, p_metric, p_quantity, p_unit,
    p_estimated_cost_usd, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (session_id, provider_request_id, metric) do nothing
  returning id into inserted_id;

  select profile.timezone into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1 from pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into public.coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (
    p_user_id,
    local_date,
    local_timezone,
    case when inserted_id is null then 0 else p_estimated_cost_usd end
  )
  on conflict (user_id, usage_date)
  do update set
    spent_usd = coach_daily_usage.spent_usd +
      case when inserted_id is null then 0 else excluded.spent_usd end,
    updated_at = clock_timestamp();

  select usage.spent_usd into current_spent
  from public.coach_daily_usage usage
  where usage.user_id = p_user_id and usage.usage_date = local_date;

  return query select
    inserted_id is not null,
    coalesce(current_spent, 0),
    daily_budget,
    greatest(0, daily_budget - coalesce(current_spent, 0));
end;
$$;

revoke all on function public.record_coach_provider_metric(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, numeric, jsonb
) from public, anon, authenticated;
grant execute on function public.record_coach_provider_metric(
  uuid, uuid, uuid, uuid, text, text, text, numeric, text, numeric, jsonb
) to service_role;

create or replace function public.claim_coach_agent_turn(
  p_user_id uuid,
  p_session_id uuid,
  p_day_id uuid,
  p_turn_key text,
  p_state_version bigint,
  p_transcript text,
  p_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn_id uuid;
  v_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  if not exists (
    select 1
    from public.coach_sessions
    where id = p_session_id
      and user_id = p_user_id
      and day_id = p_day_id
  ) then
    raise exception 'Coach session ownership mismatch';
  end if;

  if exists (
    select 1
    from public.coach_agent_turns
    where session_id = p_session_id
      and turn_key = p_turn_key
  ) then
    return null;
  end if;

  select coalesce(max(sequence_number), -1) + 1
  into v_sequence
  from public.coach_agent_turns
  where session_id = p_session_id;

  insert into public.coach_agent_turns (
    user_id,
    session_id,
    day_id,
    provider,
    turn_key,
    sequence_number,
    state_version,
    transcript,
    input_chars,
    model,
    status
  )
  values (
    p_user_id,
    p_session_id,
    p_day_id,
    'cartesia',
    p_turn_key,
    v_sequence,
    p_state_version,
    p_transcript,
    length(p_transcript),
    p_model,
    'started'
  )
  returning id into v_turn_id;

  return v_turn_id;
end;
$$;

revoke all on function public.claim_coach_agent_turn(
  uuid, uuid, uuid, text, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.claim_coach_agent_turn(
  uuid, uuid, uuid, text, bigint, text, text
) to service_role;

