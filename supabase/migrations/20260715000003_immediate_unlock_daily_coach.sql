-- Replace calendar-gated workouts with immediate sequential unlocks.
-- Keep timezone/activity-date support, but stop midnight partial finalization.

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'hoopplan-midnight-workout-rollover';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

drop function if exists public.rollover_started_workouts();

-- A partial rollover is reopened if no later workout in the plan has activity.
-- Once a later workout exists, preserving the completed chain is safer.
delete from workout_day_logs wdl
using workout_days wd
where wdl.day_id = wd.id
  and wd.completion_kind = 'partial'
  and not exists (
    select 1
    from workout_days later_day
    left join exercise_logs later_log on later_log.day_id = later_day.id
    where later_day.plan_id = wd.plan_id
      and later_day.day_number > wd.day_number
      and (later_day.completed = true or later_log.id is not null)
  );

update workout_days wd
set
  completed = false,
  completion_kind = null,
  finalized_at = null,
  locked = false
where wd.completion_kind = 'partial'
  and not exists (
    select 1
    from workout_days later_day
    left join exercise_logs later_log on later_log.day_id = later_day.id
    where later_day.plan_id = wd.plan_id
      and later_day.day_number > wd.day_number
      and (later_day.completed = true or later_log.id is not null)
  );

update workout_days
set completion_kind = 'full'
where completion_kind = 'partial';

update workout_days
set scheduled_date = null
where completed = false;

create table if not exists coach_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  timezone text not null default 'UTC',
  spent_usd numeric(12, 6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table coach_daily_usage enable row level security;

create policy "coach_daily_usage_select_own"
  on coach_daily_usage for select
  using (auth.uid() = user_id);

alter table coach_usage_logs
  add column if not exists usage_date date,
  add column if not exists updated_at timestamptz not null default now();

update coach_usage_logs cul
set usage_date = (
  cul.created_at at time zone coalesce(
    (
      select p.timezone
      from profiles p
      where p.id = cul.user_id
        and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone)
    ),
    'UTC'
  )
)::date
where cul.usage_date is null;

insert into coach_daily_usage (user_id, usage_date, timezone, spent_usd)
select
  cul.user_id,
  cul.usage_date,
  coalesce(
    (
      select p.timezone
      from profiles p
      where p.id = cul.user_id
        and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone)
    ),
    'UTC'
  ),
  sum(cul.estimated_cost_usd)
from coach_usage_logs cul
where cul.usage_date is not null
group by cul.user_id, cul.usage_date
on conflict (user_id, usage_date) do nothing;

create index if not exists idx_coach_usage_logs_user_usage_date
  on coach_usage_logs (user_id, usage_date);

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
  next_spent numeric := 0;
begin
  if p_session_key is null or length(trim(p_session_key)) = 0 then
    raise exception 'session_key is required';
  end if;
  if coalesce(p_response_count, 0) < 0
    or coalesce(p_session_duration_ms, 0) < 0
    or coalesce(p_input_text_tokens, 0) < 0
    or coalesce(p_cached_input_tokens, 0) < 0
    or coalesce(p_input_audio_tokens, 0) < 0
    or coalesce(p_output_text_tokens, 0) < 0
    or coalesce(p_output_audio_tokens, 0) < 0 then
    raise exception 'usage values must be nonnegative';
  end if;

  select p.timezone into local_timezone
  from profiles p
  where p.id = p_user_id
    and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone);
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  select coalesce(estimated_cost_usd, 0) into previous_cost
  from coach_usage_logs
  where session_key = p_session_key and user_id = p_user_id
  for update;

  if not found then
    previous_cost := 0;
  end if;
  delta_cost := greatest(0, next_cost - previous_cost);

  insert into coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict (user_id, usage_date) do nothing;

  select cdu.spent_usd into next_spent
  from coach_daily_usage cdu
  where cdu.user_id = p_user_id and cdu.usage_date = local_date
  for update;

  if next_spent + delta_cost > 0.75 then
    return query select next_spent, 0.75::numeric, greatest(0, 0.75 - next_spent), local_date;
    return;
  end if;

  update coach_daily_usage
  set spent_usd = spent_usd + delta_cost, updated_at = now()
  where user_id = p_user_id and usage_date = local_date
  returning spent_usd into next_spent;

  insert into coach_usage_logs (
    user_id, day_id, session_key, model, response_count, session_duration_ms,
    input_text_tokens, cached_input_tokens, input_audio_tokens, output_text_tokens,
    output_audio_tokens, estimated_cost_usd, usage_date, updated_at
  ) values (
    p_user_id, p_day_id, p_session_key, p_model, p_response_count, p_session_duration_ms,
    p_input_text_tokens, p_cached_input_tokens, p_input_audio_tokens, p_output_text_tokens,
    p_output_audio_tokens, next_cost, local_date, now()
  )
  on conflict (session_key) do update set
    day_id = excluded.day_id,
    model = excluded.model,
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

  return query select next_spent, 0.75::numeric, greatest(0, 0.75 - next_spent), local_date;
end;
$$;

revoke all on function public.record_coach_usage(uuid, text, uuid, text, integer, integer, integer, integer, integer, integer, integer, numeric)
  from public, anon, authenticated;
