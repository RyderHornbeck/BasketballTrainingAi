-- Provider usage reports are charged against a local calendar day. Persist
-- that attribution alongside each metric so the immutable provider ledger can
-- be reconciled with coach_daily_usage without guessing from current time.
alter table public.coach_provider_usage
  add column if not exists usage_date date,
  add column if not exists usage_timezone text;

update public.coach_provider_usage usage
set
  usage_timezone = coalesce(
    (
      select profile.timezone
      from public.profiles profile
      where profile.id = usage.user_id
        and exists (
          select 1
          from pg_timezone_names timezone
          where timezone.name = profile.timezone
        )
    ),
    'UTC'
  ),
  usage_date = (
    usage.observed_at at time zone coalesce(
      (
        select profile.timezone
        from public.profiles profile
        where profile.id = usage.user_id
          and exists (
            select 1
            from pg_timezone_names timezone
            where timezone.name = profile.timezone
          )
      ),
      'UTC'
    )
  )::date
where usage.usage_date is null or usage.usage_timezone is null;

alter table public.coach_provider_usage
  alter column usage_date set not null,
  alter column usage_timezone set not null;

create index if not exists idx_coach_provider_usage_daily_reconciliation
  on public.coach_provider_usage (user_id, usage_date);

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
  observed_at timestamptz := clock_timestamp();
  inserted_id uuid;
  current_spent numeric := 0;
  daily_budget constant numeric := 0.85;
begin
  if p_quantity < 0
    or p_estimated_cost_usd < 0
    or p_estimated_cost_usd > daily_budget
    or length(p_provider_request_id) not between 8 and 160
    or length(p_provider) not between 1 and 40
    or length(p_metric) not between 1 and 80
    or length(p_unit) not between 1 and 40
  then
    raise exception 'Invalid coach provider usage metric';
  end if;

  if not exists (
    select 1
    from public.coach_sessions session
    where session.id = p_session_id
      and session.user_id = p_user_id
      and session.day_id = p_day_id
  ) then
    raise exception 'Coach session ownership mismatch';
  end if;

  select profile.timezone into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1
      from pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (observed_at at time zone local_timezone)::date;

  insert into public.coach_provider_usage (
    session_id, turn_id, user_id, day_id, provider, provider_request_id,
    metric, quantity, unit, estimated_cost_usd, observed_at, usage_date,
    usage_timezone, metadata
  ) values (
    p_session_id, p_turn_id, p_user_id, p_day_id, p_provider,
    p_provider_request_id, p_metric, p_quantity, p_unit,
    p_estimated_cost_usd, observed_at, local_date, local_timezone,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (session_id, provider_request_id, metric) do nothing
  returning id into inserted_id;

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
    updated_at = observed_at;

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
