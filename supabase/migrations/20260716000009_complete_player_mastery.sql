-- Replace the original one-drill-per-category Complete Player requirement
-- with meaningful broad mastery: 20 completed drills in every active core
-- category. A fresh key preserves the history of the retired requirement.

create or replace function public.evaluate_complete_player_mastery(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  category_floor integer := 0;
  inserted_count integer := 0;
begin
  if p_user_id is null then return 0; end if;

  select least(
    count(*) filter (where we.category = 'shooting'),
    count(*) filter (where we.category = 'ball_handling'),
    count(*) filter (where we.category = 'finishing'),
    count(*) filter (where we.category = 'conditioning'),
    count(*) filter (where we.category = 'defense')
  )::integer
  into category_floor
  from exercise_logs el
  join workout_exercises we on we.id = el.exercise_id
  where el.user_id = p_user_id and el.completed = true;

  if coalesce(category_floor, 0) >= 20 then
    insert into user_achievements (user_id, achievement_key, metric_value)
    values (p_user_id, 'all_rounder_20', category_floor)
    on conflict (user_id, achievement_key) do nothing;
    get diagnostics inserted_count = row_count;
  end if;

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
  return new;
end;
$$;

revoke all on function public.evaluate_complete_player_mastery(uuid) from public, anon, authenticated;

do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform public.evaluate_complete_player_mastery(profile_row.id);
  end loop;
end;
$$;
