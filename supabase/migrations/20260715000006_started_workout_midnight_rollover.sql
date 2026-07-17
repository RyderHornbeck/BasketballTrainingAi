-- At each user's local midnight, close only the current started workout.
-- Untouched workouts remain open until the athlete starts or explicitly finishes them.

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
  completion text;
  local_midnight timestamptz;
begin
  for candidate in
    select
      wd.id,
      wd.plan_id,
      wd.user_id,
      wd.day_number,
      p.timezone as user_timezone,
      (wd.last_activity_at at time zone p.timezone)::date as activity_date
    from workout_days wd
    join profiles p on p.id = wd.user_id
    join pg_timezone_names tz on tz.name = p.timezone
    where wd.completed = false
      and wd.locked = false
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
        where el.day_id = wd.id
      )
    order by wd.last_activity_at
    for update of wd skip locked
  loop
    local_midnight := (
      (candidate.activity_date + 1)::timestamp at time zone candidate.user_timezone
    );

    select coalesce(sum(coalesce(el.minutes_completed, 0)), 0)::integer
    into actual_minutes
    from exercise_logs el
    where el.day_id = candidate.id;

    select case
      when count(we.id) > 0
        and bool_and(coalesce(el.completed, false))
        then 'full'
      else 'partial'
    end
    into completion
    from workout_exercises we
    left join exercise_logs el on el.exercise_id = we.id
    where we.day_id = candidate.id;

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
      completion_kind = completion::text,
      finalized_at = local_midnight
    where id = candidate.id
      and completed = false;

    update workout_days
    set
      locked = false,
      scheduled_date = null
    where plan_id = candidate.plan_id
      and day_number = candidate.day_number + 1
      and completed = false;

    rolled_over := rolled_over + 1;
  end loop;

  return rolled_over;
end;
$$;

revoke all on function public.rollover_started_workouts() from public, anon, authenticated;

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

select cron.schedule(
  'hoopplan-midnight-workout-rollover',
  '* * * * *',
  'select public.rollover_started_workouts();'
);
