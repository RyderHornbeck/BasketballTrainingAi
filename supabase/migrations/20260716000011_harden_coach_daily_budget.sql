-- Make daily usage reads timezone-safe and server-owned, reserve a small
-- amount for every opened Realtime session, and cap over-budget reports.

create or replace function public.get_my_coach_daily_usage()
returns table (
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric,
  usage_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  local_timezone text := 'UTC';
  local_date date;
  current_spent numeric := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select p.timezone into local_timezone
  from profiles p
  where p.id = auth.uid()
    and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone);
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  select coalesce(cdu.spent_usd, 0) into current_spent
  from coach_daily_usage cdu
  where cdu.user_id = auth.uid() and cdu.usage_date = local_date;

  return query
  select current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent), local_date;
end;
$$;

create or replace function public.reserve_coach_session_usage(
  p_user_id uuid,
  p_session_key text,
  p_day_id uuid,
  p_model text,
  p_reservation_usd numeric default 0.0025
)
returns table (
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric,
  allowed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  local_timezone text := 'UTC';
  local_date date;
  current_spent numeric := 0;
  reservation numeric := greatest(0.000001, coalesce(p_reservation_usd, 0.0025));
begin
  if p_user_id is null or p_session_key is null or length(trim(p_session_key)) = 0 then
    raise exception 'user_id and session_key are required';
  end if;

  select p.timezone into local_timezone
  from profiles p
  where p.id = p_user_id
    and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone);
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict (user_id, usage_date) do nothing;

  select cdu.spent_usd into current_spent
  from coach_daily_usage cdu
  where cdu.user_id = p_user_id and cdu.usage_date = local_date
  for update;

  if exists (
    select 1 from coach_usage_logs cul
    where cul.user_id = p_user_id and cul.session_key = p_session_key
  ) then
    return query
    select current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent), current_spent < 0.75;
    return;
  end if;

  if current_spent + reservation > 0.75 then
    update coach_daily_usage
    set spent_usd = 0.75, updated_at = now()
    where user_id = p_user_id and usage_date = local_date;
    return query select 0.75::numeric, 0.75::numeric, 0::numeric, false;
    return;
  end if;

  update coach_daily_usage
  set spent_usd = spent_usd + reservation, updated_at = now()
  where user_id = p_user_id and usage_date = local_date
  returning coach_daily_usage.spent_usd into current_spent;

  insert into coach_usage_logs (
    user_id, day_id, session_key, model, estimated_cost_usd, usage_date, updated_at
  ) values (
    p_user_id, p_day_id, p_session_key, p_model, reservation, local_date, now()
  )
  on conflict (session_key) do nothing;

  return query
  select current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent), true;
end;
$$;

create or replace function public.record_coach_usage(
  p_user_id uuid,
  p_session_key text,
  p_day_id uuid,
  p_model text,
  p_response_count integer,
  p_session_duration_ms integer,
  p_input_text_tokens integer,
  p_cached_input_tokens integer,
  p_input_audio_tokens integer,
  p_output_text_tokens integer,
  p_output_audio_tokens integer,
  p_estimated_cost_usd numeric
)
returns table (
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric,
  usage_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  local_timezone text := 'UTC';
  local_date date;
  previous_cost numeric := 0;
  next_cost numeric := greatest(0, coalesce(p_estimated_cost_usd, 0));
  delta_cost numeric := 0;
  accepted_delta numeric := 0;
  next_spent numeric := 0;
begin
  if p_session_key is null or length(trim(p_session_key)) = 0 then
    raise exception 'session_key is required';
  end if;

  select p.timezone into local_timezone
  from profiles p
  where p.id = p_user_id
    and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone);
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict (user_id, usage_date) do nothing;

  select cdu.spent_usd into next_spent
  from coach_daily_usage cdu
  where cdu.user_id = p_user_id and cdu.usage_date = local_date
  for update;

  select coalesce(cul.estimated_cost_usd, 0) into previous_cost
  from coach_usage_logs cul
  where cul.session_key = p_session_key and cul.user_id = p_user_id
  for update;
  if not found then previous_cost := 0; end if;

  delta_cost := greatest(0, next_cost - previous_cost);
  accepted_delta := least(delta_cost, greatest(0, 0.75 - next_spent));

  update coach_daily_usage
  set spent_usd = least(0.75, spent_usd + accepted_delta), updated_at = now()
  where user_id = p_user_id and usage_date = local_date
  returning coach_daily_usage.spent_usd into next_spent;

  insert into coach_usage_logs (
    user_id, day_id, session_key, model, response_count, session_duration_ms,
    input_text_tokens, cached_input_tokens, input_audio_tokens, output_text_tokens,
    output_audio_tokens, estimated_cost_usd, usage_date, updated_at
  ) values (
    p_user_id, p_day_id, p_session_key, p_model, greatest(0, p_response_count),
    greatest(0, p_session_duration_ms), greatest(0, p_input_text_tokens),
    greatest(0, p_cached_input_tokens), greatest(0, p_input_audio_tokens),
    greatest(0, p_output_text_tokens), greatest(0, p_output_audio_tokens),
    greatest(previous_cost, next_cost), local_date, now()
  )
  on conflict (session_key) do update set
    response_count = greatest(coach_usage_logs.response_count, excluded.response_count),
    session_duration_ms = greatest(coach_usage_logs.session_duration_ms, excluded.session_duration_ms),
    input_text_tokens = greatest(coach_usage_logs.input_text_tokens, excluded.input_text_tokens),
    cached_input_tokens = greatest(coach_usage_logs.cached_input_tokens, excluded.cached_input_tokens),
    input_audio_tokens = greatest(coach_usage_logs.input_audio_tokens, excluded.input_audio_tokens),
    output_text_tokens = greatest(coach_usage_logs.output_text_tokens, excluded.output_text_tokens),
    output_audio_tokens = greatest(coach_usage_logs.output_audio_tokens, excluded.output_audio_tokens),
    estimated_cost_usd = greatest(coach_usage_logs.estimated_cost_usd, excluded.estimated_cost_usd),
    usage_date = excluded.usage_date,
    updated_at = now();

  if delta_cost > accepted_delta then next_spent := 0.75; end if;
  return query
  select next_spent, 0.75::numeric, greatest(0, 0.75 - next_spent), local_date;
end;
$$;

revoke all on function public.get_my_coach_daily_usage() from public, anon;
grant execute on function public.get_my_coach_daily_usage() to authenticated;
revoke all on function public.reserve_coach_session_usage(uuid, text, uuid, text, numeric)
  from public, anon, authenticated;
revoke all on function public.record_coach_usage(uuid, text, uuid, text, integer, integer, integer, integer, integer, integer, integer, numeric)
  from public, anon, authenticated;
