-- Fix the bounded Single Arm Shooting clip.
update public.exercise_video_clips
set
  start_seconds = 46,
  end_seconds = 78,
  youtube_url = 'https://www.youtube.com/watch?v=MxO-5-bJmoM&t=46s'
where id = '54536f7a-44aa-450e-893f-1fb7c071b797';

-- Achievement unlocks are permanent and idempotent.
create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null,
  unlocked_at timestamptz not null default now(),
  metric_value numeric not null default 0,
  primary key (user_id, achievement_key)
);

alter table public.user_achievements enable row level security;

create policy "user_achievements_select_own"
  on public.user_achievements for select
  using (auth.uid() = user_id);

create or replace function public.evaluate_user_achievements(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  workout_count integer := 0;
  training_minutes integer := 0;
  total_makes integer := 0;
  total_attempts integer := 0;
  longest_streak integer := 0;
  full_workouts integer := 0;
  shooting_drills integer := 0;
  handling_drills integer := 0;
  finishing_drills integer := 0;
  conditioning_drills integer := 0;
  defense_drills integer := 0;
  strength_drills integer := 0;
  core_categories integer := 0;
  inserted_count integer := 0;
begin
  if p_user_id is null then return 0; end if;

  select count(*)::integer,
         count(*) filter (where completion_kind = 'full' or completion_kind is null)::integer
  into workout_count, full_workouts
  from workout_days
  where user_id = p_user_id and completed = true;

  select coalesce(sum(total_minutes), 0)::integer
  into training_minutes
  from workout_day_logs
  where user_id = p_user_id;

  select
    coalesce(sum(case when completed then makes else 0 end), 0)::integer,
    coalesce(sum(case when completed then attempts else 0 end), 0)::integer
  into total_makes, total_attempts
  from exercise_logs
  where user_id = p_user_id;

  with activity_dates as (
    select distinct coalesce(activity_date, completed_at::date) as activity_date
    from workout_day_logs
    where user_id = p_user_id
  ),
  grouped_dates as (
    select
      activity_date,
      activity_date - row_number() over (order by activity_date)::integer as streak_group
    from activity_dates
  ),
  streak_lengths as (
    select count(*)::integer as streak_length
    from grouped_dates
    group by streak_group
  )
  select coalesce(max(streak_length), 0)
  into longest_streak
  from streak_lengths;

  select
    count(*) filter (where we.category = 'shooting')::integer,
    count(*) filter (where we.category = 'ball_handling')::integer,
    count(*) filter (where we.category = 'finishing')::integer,
    count(*) filter (where we.category = 'conditioning')::integer,
    count(*) filter (where we.category = 'defense')::integer,
    count(*) filter (where we.category = 'strength')::integer,
    count(distinct we.category) filter (
      where we.category in (
        'shooting', 'ball_handling', 'finishing',
        'conditioning', 'defense', 'strength'
      )
    )::integer
  into
    shooting_drills, handling_drills, finishing_drills,
    conditioning_drills, defense_drills, strength_drills, core_categories
  from exercise_logs el
  join workout_exercises we on we.id = el.exercise_id
  where el.user_id = p_user_id and el.completed = true;

  insert into user_achievements (user_id, achievement_key, metric_value)
  select p_user_id, achievement_key, metric_value
  from (
    select 'streak_1'::text, longest_streak::numeric, longest_streak >= 1
    union all select 'streak_3', longest_streak, longest_streak >= 3
    union all select 'streak_10', longest_streak, longest_streak >= 10
    union all select 'streak_50', longest_streak, longest_streak >= 50
    union all select 'streak_100', longest_streak, longest_streak >= 100
    union all select 'workouts_1', workout_count, workout_count >= 1
    union all select 'workouts_5', workout_count, workout_count >= 5
    union all select 'workouts_10', workout_count, workout_count >= 10
    union all select 'workouts_25', workout_count, workout_count >= 25
    union all select 'workouts_50', workout_count, workout_count >= 50
    union all select 'workouts_100', workout_count, workout_count >= 100
    union all select 'minutes_60', training_minutes, training_minutes >= 60
    union all select 'minutes_300', training_minutes, training_minutes >= 300
    union all select 'minutes_1000', training_minutes, training_minutes >= 1000
    union all select 'minutes_3000', training_minutes, training_minutes >= 3000
    union all select 'makes_10', total_makes, total_makes >= 10
    union all select 'makes_100', total_makes, total_makes >= 100
    union all select 'makes_500', total_makes, total_makes >= 500
    union all select 'makes_1000', total_makes, total_makes >= 1000
    union all select 'shooting_25', shooting_drills, shooting_drills >= 25
    union all select 'handling_25', handling_drills, handling_drills >= 25
    union all select 'finishing_25', finishing_drills, finishing_drills >= 25
    union all select 'conditioning_25', conditioning_drills, conditioning_drills >= 25
    union all select 'defense_25', defense_drills, defense_drills >= 25
    union all select 'strength_25', strength_drills, strength_drills >= 25
    union all select 'accuracy_70', total_attempts,
      total_attempts >= 100 and total_makes::numeric / nullif(total_attempts, 0) >= 0.70
    union all select 'accuracy_80', total_attempts,
      total_attempts >= 250 and total_makes::numeric / nullif(total_attempts, 0) >= 0.80
    union all select 'full_10', full_workouts, full_workouts >= 10
    union all select 'full_50', full_workouts, full_workouts >= 50
    union all select 'all_rounder', core_categories, core_categories >= 6
  ) earned(achievement_key, metric_value, qualifies)
  where qualifies
  on conflict (user_id, achievement_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.evaluate_my_achievements()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.evaluate_user_achievements(auth.uid());
$$;

revoke all on function public.evaluate_user_achievements(uuid) from public, anon, authenticated;
revoke all on function public.evaluate_my_achievements() from public, anon;
grant execute on function public.evaluate_my_achievements() to authenticated;

create or replace function public.refresh_achievements_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_user_achievements(new.user_id);
  return new;
end;
$$;

drop trigger if exists exercise_logs_refresh_achievements on public.exercise_logs;
create trigger exercise_logs_refresh_achievements
  after insert or update on public.exercise_logs
  for each row execute function public.refresh_achievements_from_activity();

drop trigger if exists workout_days_refresh_achievements on public.workout_days;
create trigger workout_days_refresh_achievements
  after insert or update of completed, completion_kind on public.workout_days
  for each row execute function public.refresh_achievements_from_activity();

drop trigger if exists workout_day_logs_refresh_achievements on public.workout_day_logs;
create trigger workout_day_logs_refresh_achievements
  after insert or update on public.workout_day_logs
  for each row execute function public.refresh_achievements_from_activity();

do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.evaluate_user_achievements(profile_row.id);
  end loop;
end;
$$;
