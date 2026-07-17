-- Extend the shooting achievement ladder with long-term volume and
-- high-accuracy milestones.

create or replace function public.evaluate_elite_shooting_achievements(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total_makes integer := 0;
  total_attempts integer := 0;
  inserted_count integer := 0;
begin
  if p_user_id is null then return 0; end if;

  select
    coalesce(sum(case when completed then makes else 0 end), 0)::integer,
    coalesce(sum(case when completed then attempts else 0 end), 0)::integer
  into total_makes, total_attempts
  from exercise_logs
  where user_id = p_user_id;

  insert into user_achievements (user_id, achievement_key, metric_value)
  select p_user_id, achievement_key, metric_value
  from (
    select 'makes_2500'::text, total_makes::numeric, total_makes >= 2500
    union all select 'makes_5000', total_makes, total_makes >= 5000
    union all select 'makes_10000', total_makes, total_makes >= 10000
    union all select 'makes_25000', total_makes, total_makes >= 25000
    union all select 'accuracy_85', total_attempts,
      total_attempts >= 500
      and total_makes::numeric / nullif(total_attempts, 0) >= 0.85
    union all select 'accuracy_90', total_attempts,
      total_attempts >= 1000
      and total_makes::numeric / nullif(total_attempts, 0) >= 0.90
    union all select 'accuracy_95', total_attempts,
      total_attempts >= 2500
      and total_makes::numeric / nullif(total_attempts, 0) >= 0.95
  ) earned(achievement_key, metric_value, qualifies)
  where qualifies
  on conflict (user_id, achievement_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.evaluate_my_achievements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  inserted_count := inserted_count + public.evaluate_user_achievements(auth.uid());
  inserted_count := inserted_count + public.evaluate_complete_player_mastery(auth.uid());
  inserted_count := inserted_count + public.evaluate_elite_shooting_achievements(auth.uid());
  return inserted_count;
end;
$$;

create or replace function public.refresh_achievements_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_user_achievements(new.user_id);
  perform public.evaluate_complete_player_mastery(new.user_id);
  perform public.evaluate_elite_shooting_achievements(new.user_id);
  return new;
end;
$$;

revoke all on function public.evaluate_elite_shooting_achievements(uuid)
  from public, anon, authenticated;
revoke all on function public.evaluate_my_achievements() from public, anon;
grant execute on function public.evaluate_my_achievements() to authenticated;

do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.evaluate_elite_shooting_achievements(profile_row.id);
  end loop;
end;
$$;
