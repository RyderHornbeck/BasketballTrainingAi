-- Allow 200 five-workout blocks (1,000 total workout days) per active plan.
create or replace function public.create_my_plan_generation_request(
  p_generation_type text default 'initial',
  p_target_plan_id uuid default null,
  p_block_index integer default 1
)
returns setof public.plan_generation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text || ':plan-generation', 0)
  );

  return query
  select request.*
  from public.plan_generation_requests request
  where request.user_id = caller
    and request.status in ('pending', 'generating')
  order by request.created_at desc
  limit 1;
  if found then return; end if;

  if p_generation_type not in ('initial', 'extend') then
    raise exception 'Invalid generation type';
  end if;
  if p_block_index is null or p_block_index < 1 or p_block_index > 200 then
    raise exception 'Invalid block index';
  end if;
  if p_generation_type = 'initial' then
    p_target_plan_id := null;
    p_block_index := 1;
  elsif p_target_plan_id is null or not exists (
    select 1
    from public.workout_plans plan
    where plan.id = p_target_plan_id
      and plan.user_id = caller
      and plan.active = true
  ) then
    raise exception 'Target plan not found' using errcode = '42501';
  end if;

  return query
  insert into public.plan_generation_requests (
    user_id, status, generation_type, target_plan_id, block_index
  )
  values (
    caller, 'pending', p_generation_type, p_target_plan_id, p_block_index
  )
  returning *;
end;
$$;

notify pgrst, 'reload schema';
