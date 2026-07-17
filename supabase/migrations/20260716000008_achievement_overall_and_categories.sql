-- Keep achievement requirements aligned with the active training catalog.
-- Strength has no usable catalog yet, so its badge becomes an earlier
-- conditioning milestone. Overall ratings are calculated by the app's
-- adaptive-rating engine and persisted here for server-side achievement awards.

create table if not exists public.user_skill_rating_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overall_rating integer not null check (overall_rating between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.user_skill_rating_snapshots enable row level security;

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
  core_categories integer := 0;
  overall_rating integer := 0;
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
    count(distinct we.category) filter (
      where we.category in (
        'shooting', 'ball_handling', 'finishing', 'conditioning', 'defense'
      )
    )::integer
  into
    shooting_drills, handling_drills, finishing_drills,
    conditioning_drills, defense_drills, core_categories
  from exercise_logs el
  join workout_exercises we on we.id = el.exercise_id
  where el.user_id = p_user_id and el.completed = true;

  select coalesce(max(snapshot.overall_rating), 0)
  into overall_rating
  from user_skill_rating_snapshots snapshot
  where snapshot.user_id = p_user_id;

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
    union all select 'conditioning_10', conditioning_drills, conditioning_drills >= 10
    union all select 'conditioning_25', conditioning_drills, conditioning_drills >= 25
    union all select 'defense_25', defense_drills, defense_drills >= 25
    union all select 'accuracy_70', total_attempts,
      total_attempts >= 100 and total_makes::numeric / nullif(total_attempts, 0) >= 0.70
    union all select 'accuracy_80', total_attempts,
      total_attempts >= 250 and total_makes::numeric / nullif(total_attempts, 0) >= 0.80
    union all select 'full_10', full_workouts, full_workouts >= 10
    union all select 'full_50', full_workouts, full_workouts >= 50
    union all select 'all_rounder', core_categories, core_categories >= 5
    union all select 'overall_70', overall_rating, overall_rating >= 70
    union all select 'overall_80', overall_rating, overall_rating >= 80
    union all select 'overall_90', overall_rating, overall_rating >= 90
    union all select 'overall_100', overall_rating, overall_rating >= 100
  ) earned(achievement_key, metric_value, qualifies)
  where qualifies
  on conflict (user_id, achievement_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.sync_my_overall_skill_rating(p_overall_rating integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_rating integer := greatest(0, least(100, coalesce(p_overall_rating, 0)));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into user_skill_rating_snapshots (user_id, overall_rating, updated_at)
  values (auth.uid(), normalized_rating, now())
  on conflict (user_id) do update
  set overall_rating = greatest(user_skill_rating_snapshots.overall_rating, excluded.overall_rating),
      updated_at = now();

  return public.evaluate_user_achievements(auth.uid());
end;
$$;

revoke all on function public.sync_my_overall_skill_rating(integer) from public, anon;
grant execute on function public.sync_my_overall_skill_rating(integer) to authenticated;

-- Users who have already earned the retired strength badge keep it.
-- New qualification uses the active conditioning milestone instead.
do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.evaluate_user_achievements(profile_row.id);
  end loop;
end;
$$;
