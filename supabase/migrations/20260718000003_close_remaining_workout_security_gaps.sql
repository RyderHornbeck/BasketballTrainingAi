-- Follow-up integrity fixes identified while verifying the workout repair.

-- Registering this device's notification token is an owned profile operation.
grant update (push_token) on public.profiles to authenticated;

-- Remove three-valued behavior from security-sensitive workout state.
update public.workout_days
set locked = coalesce(locked, true),
    completed = coalesce(completed, false)
where locked is null or completed is null;

alter table public.workout_days
  alter column locked set not null,
  alter column completed set not null;

-- An empty workout is partial, not a fully completed workout.
create or replace function public.finish_my_workout_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_day public.workout_days%rowtype;
  completion text;
  trained_minutes integer;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
  into target_day
  from public.workout_days
  where id = p_day_id and user_id = caller
  for update;
  if not found then
    raise exception 'Workout day not found' using errcode = '42501';
  end if;
  if target_day.completed then return; end if;
  if target_day.locked then
    raise exception 'Workout day is locked' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.workout_days previous
    where previous.plan_id = target_day.plan_id
      and previous.day_number = target_day.day_number - 1
      and previous.completed = false
  ) then
    raise exception 'Previous workout must be completed first' using errcode = '42501';
  end if;

  completion := case
    when exists (
      select 1
      from public.workout_exercises exercise
      where exercise.day_id = target_day.id
        and exercise.user_id = caller
    )
    and not exists (
      select 1
      from public.workout_exercises exercise
      left join public.exercise_logs log
        on log.exercise_id = exercise.id
       and log.user_id = caller
      where exercise.day_id = target_day.id
        and exercise.user_id = caller
        and coalesce(log.completed, false) = false
    )
    then 'full'
    else 'partial'
  end;

  select coalesce(sum(greatest(0, coalesce(log.minutes_completed, 0))), 0)::integer
  into trained_minutes
  from public.exercise_logs log
  where log.day_id = target_day.id
    and log.user_id = caller;
  if trained_minutes = 0 then
    trained_minutes := greatest(1, coalesce(target_day.estimated_minutes, 1));
  end if;

  insert into public.workout_day_logs (day_id, user_id, completed_at, total_minutes)
  values (target_day.id, caller, now(), trained_minutes)
  on conflict (day_id) do update
  set completed_at = excluded.completed_at,
      total_minutes = excluded.total_minutes;

  update public.workout_days
  set completed = true,
      locked = false,
      completion_kind = completion,
      finalized_at = now()
  where id = target_day.id and user_id = caller;

  update public.workout_days
  set locked = false, scheduled_date = null
  where plan_id = target_day.plan_id
    and user_id = caller
    and day_number = target_day.day_number + 1;
end;
$$;

revoke all on function public.finish_my_workout_day(uuid)
  from public, anon;
grant execute on function public.finish_my_workout_day(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
