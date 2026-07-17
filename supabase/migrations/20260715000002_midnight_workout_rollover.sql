-- Finalize meaningfully-started workouts at the athlete's next local midnight.
-- Partial rollovers count as completed workouts while preserving their set logs.

create extension if not exists pg_cron;

alter table profiles
  add column if not exists timezone text;

alter table exercise_logs
  add column if not exists updated_at timestamptz not null default now();

alter table workout_days
  add column if not exists last_activity_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists completion_kind text;

alter table workout_day_logs
  add column if not exists activity_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_days_completion_kind_check'
  ) then
    alter table workout_days
      add constraint workout_days_completion_kind_check
      check (completion_kind is null or completion_kind in ('full', 'partial'));
  end if;
end
$$;

update exercise_logs
set updated_at = created_at
where updated_at is null;

update workout_days wd
set last_activity_at = activity.latest_activity
from (
  select day_id, max(coalesce(updated_at, created_at)) as latest_activity
  from exercise_logs
  group by day_id
) activity
where wd.id = activity.day_id
  and wd.last_activity_at is null;

update workout_days wd
set
  completion_kind = coalesce(wd.completion_kind, 'full'),
  finalized_at = coalesce(wd.finalized_at, wdl.completed_at)
from workout_day_logs wdl
where wdl.day_id = wd.id
  and wd.completed = true;

update workout_day_logs wdl
set activity_date = (
  wdl.completed_at at time zone coalesce(
    (
      select p.timezone
      from profiles p
      where p.id = wdl.user_id
        and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone)
    ),
    'UTC'
  )
)::date
where wdl.activity_date is null;

create index if not exists idx_workout_days_pending_activity
  on workout_days (last_activity_at)
  where completed = false;

create or replace function public.try_hoop_log_meta(raw_notes text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  prefix constant text := '__hoop_set_logs__:';
begin
  if raw_notes is null or left(raw_notes, length(prefix)) <> prefix then
    return null;
  end if;
  return substring(raw_notes from length(prefix) + 1)::jsonb;
exception
  when others then
    return null;
end;
$$;

create or replace function public.touch_workout_activity_from_exercise_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  update workout_days
  set last_activity_at = new.updated_at
  where id = new.day_id
    and completed = false;
  return new;
end;
$$;

drop trigger if exists exercise_logs_touch_workout_activity on exercise_logs;
create trigger exercise_logs_touch_workout_activity
before insert or update on exercise_logs
for each row execute function public.touch_workout_activity_from_exercise_log();

create or replace function public.set_workout_completion_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.completed = true and old.completed = false then
    new.completion_kind := coalesce(new.completion_kind, 'full');
    new.finalized_at := coalesce(new.finalized_at, now());
  elsif new.completed = false and old.completed = true then
    new.completion_kind := null;
    new.finalized_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_days_set_completion_metadata on workout_days;
create trigger workout_days_set_completion_metadata
before update of completed on workout_days
for each row execute function public.set_workout_completion_metadata();

create or replace function public.set_workout_log_activity_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  user_timezone text;
begin
  if new.activity_date is not null then
    return new;
  end if;

  select p.timezone
  into user_timezone
  from profiles p
  where p.id = new.user_id
    and exists (select 1 from pg_timezone_names tz where tz.name = p.timezone);

  new.activity_date := (
    coalesce(new.completed_at, now()) at time zone coalesce(user_timezone, 'UTC')
  )::date;
  return new;
end;
$$;

drop trigger if exists workout_day_logs_set_activity_date on workout_day_logs;
create trigger workout_day_logs_set_activity_date
before insert or update of completed_at, activity_date on workout_day_logs
for each row execute function public.set_workout_log_activity_date();

create or replace function public.rollover_started_workouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  rolled_over integer := 0;
  actual_minutes integer;
  local_today date;
  local_midnight timestamptz;
begin
  for candidate in
    select
      wd.id,
      wd.plan_id,
      wd.user_id,
      wd.day_number,
      wd.last_activity_at,
      p.timezone as user_timezone,
      (wd.last_activity_at at time zone p.timezone)::date as activity_date
    from workout_days wd
    join profiles p on p.id = wd.user_id
    join pg_timezone_names tz on tz.name = p.timezone
    where wd.completed = false
      and wd.last_activity_at is not null
      and (wd.last_activity_at at time zone p.timezone)::date
        < (clock_timestamp() at time zone p.timezone)::date
      and not exists (
        select 1
        from workout_days previous
        where previous.plan_id = wd.plan_id
          and previous.day_number < wd.day_number
          and previous.completed = false
      )
      and exists (
        select 1
        from exercise_logs el
        cross join lateral (
          select public.try_hoop_log_meta(el.notes) as meta
        ) parsed
        where el.day_id = wd.id
          and (
            el.makes is not null
            or (
              jsonb_typeof(parsed.meta -> 'set_logs') = 'array'
              and jsonb_path_exists(
                parsed.meta,
                '$.set_logs[*] ? (@.completed == true)'
              )
            )
            or (
              (
                parsed.meta is null
                or jsonb_typeof(parsed.meta -> 'set_logs') <> 'array'
              )
              and el.completed = true
            )
          )
      )
    order by wd.last_activity_at
    for update of wd skip locked
  loop
    local_today := (clock_timestamp() at time zone candidate.user_timezone)::date;
    local_midnight := (
      (candidate.activity_date + 1)::timestamp at time zone candidate.user_timezone
    );

    select coalesce(sum(coalesce(el.minutes_completed, 0)), 0)::integer
    into actual_minutes
    from exercise_logs el
    where el.day_id = candidate.id;

    insert into workout_day_logs (
      day_id,
      user_id,
      completed_at,
      activity_date,
      total_minutes
    )
    values (
      candidate.id,
      candidate.user_id,
      local_midnight,
      candidate.activity_date,
      actual_minutes
    )
    on conflict (day_id) do update
    set
      completed_at = excluded.completed_at,
      activity_date = excluded.activity_date,
      total_minutes = excluded.total_minutes;

    update workout_days
    set
      completed = true,
      locked = false,
      completion_kind = 'partial',
      finalized_at = local_midnight
    where id = candidate.id
      and completed = false;

    update workout_days
    set
      locked = false,
      scheduled_date = local_today
    where plan_id = candidate.plan_id
      and day_number = candidate.day_number + 1
      and completed = false;

    rolled_over := rolled_over + 1;
  end loop;

  return rolled_over;
end;
$$;

revoke all on function public.try_hoop_log_meta(text) from public, anon, authenticated;
revoke all on function public.rollover_started_workouts() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'hoopplan-midnight-workout-rollover';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'hoopplan-midnight-workout-rollover',
  '* * * * *',
  'select public.rollover_started_workouts();'
);
