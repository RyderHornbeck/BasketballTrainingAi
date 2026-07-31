create table if not exists public.coach_workout_guidance (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null references public.workout_days(id) on delete cascade,
  recommendation_offer_count integer not null default 0
    check (recommendation_offer_count between 0 and 2),
  last_offer_reason text,
  last_offered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_id)
);

alter table public.coach_workout_guidance enable row level security;

create or replace function public.reserve_coach_recommendation_offer(
  p_user_id uuid,
  p_day_id uuid,
  p_reason text
)
returns table(allowed boolean, offer_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
    from public.workout_days wd
    join public.workout_plans wp on wp.id = wd.plan_id
    where wd.id = p_day_id and wp.user_id = p_user_id
  ) then
    return query select false, 0;
    return;
  end if;

  insert into public.coach_workout_guidance (
    user_id,
    day_id,
    recommendation_offer_count,
    last_offer_reason,
    last_offered_at
  )
  values (p_user_id, p_day_id, 1, left(p_reason, 240), now())
  on conflict (user_id, day_id) do update
    set recommendation_offer_count =
          public.coach_workout_guidance.recommendation_offer_count + 1,
        last_offer_reason = left(excluded.last_offer_reason, 240),
        last_offered_at = now(),
        updated_at = now()
    where public.coach_workout_guidance.recommendation_offer_count < 2
  returning recommendation_offer_count into v_count;

  if v_count is null then
    select recommendation_offer_count
      into v_count
      from public.coach_workout_guidance
     where user_id = p_user_id and day_id = p_day_id;
    return query select false, coalesce(v_count, 2);
  else
    return query select true, v_count;
  end if;
end;
$$;

revoke all on function public.reserve_coach_recommendation_offer(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_coach_recommendation_offer(uuid, uuid, text)
  to service_role;
