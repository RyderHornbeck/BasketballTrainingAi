-- Persist Coach/UI set selection separately from completion. This lets an
-- athlete skip ahead without falsely marking the prior set complete.
alter table public.workout_days
  add column if not exists active_set_number integer;

alter table public.workout_days
  drop constraint if exists workout_days_active_set_number_positive;

alter table public.workout_days
  add constraint workout_days_active_set_number_positive
  check (active_set_number is null or active_set_number > 0);

-- Keep the active set coupled to the active exercise. The application validates
-- the upper bound because effective set plans are derived from exercise data.
create or replace function public.validate_workout_active_exercise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_set_number is not null and new.active_exercise_id is null then
    raise exception 'active set requires an active exercise';
  end if;

  if new.active_exercise_id is not null and not exists (
    select 1
    from public.workout_exercises exercise
    where exercise.id = new.active_exercise_id
      and exercise.day_id = new.id
      and exercise.user_id = new.user_id
  ) then
    raise exception 'active exercise must belong to this workout day';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_days_validate_active_exercise on public.workout_days;
create constraint trigger workout_days_validate_active_exercise
after insert or update of active_exercise_id, active_set_number, user_id
on public.workout_days
deferrable initially deferred
for each row execute function public.validate_workout_active_exercise();
