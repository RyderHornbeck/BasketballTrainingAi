-- Limit AI workout-editor conversations per workout instead of exposing or
-- enforcing the previous daily allowance.

create or replace function public.reserve_workout_editor_request(
  p_user_id uuid,
  p_day_id uuid,
  p_request_id text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_timezone text := 'UTC';
  local_date date;
  current_count integer;
  workout_limit constant integer := 10;
begin
  if p_user_id is null
    or p_request_id is null
    or length(p_request_id) not between 8 and 200
    or p_message is null
    or length(p_message) not between 1 and 1200 then
    raise exception 'Invalid workout editor request';
  end if;
  if not exists (
    select 1
    from public.workout_days
    where id = p_day_id and user_id = p_user_id
  ) then
    raise exception 'Workout day not found' using errcode = '42501';
  end if;

  -- Serialize reservations for this athlete and workout so parallel requests
  -- cannot both claim the final available message.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':workout-editor:' || p_day_id::text, 0)
  );

  select count(*)::integer
  into current_count
  from public.workout_edit_messages
  where user_id = p_user_id
    and day_id = p_day_id
    and role = 'user';

  if exists (
    select 1
    from public.workout_edit_messages
    where user_id = p_user_id and request_id = p_request_id
  ) then
    return jsonb_build_object(
      'status', 'duplicate',
      'remaining', greatest(0, workout_limit - current_count)
    );
  end if;
  if current_count >= workout_limit then
    return jsonb_build_object('status', 'limit', 'remaining', 0);
  end if;

  insert into public.workout_edit_messages (
    user_id, day_id, role, content, request_id
  ) values (
    p_user_id, p_day_id, 'user', p_message, p_request_id
  );

  -- Keep the existing durable aggregate ledger for abuse analysis without
  -- using it as the user-facing limit.
  select profile.timezone
  into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1
      from pg_catalog.pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into public.workout_editor_daily_usage (user_id, usage_date, request_count)
  values (p_user_id, local_date, 1)
  on conflict (user_id, usage_date) do update
  set request_count = least(50, public.workout_editor_daily_usage.request_count + 1),
      updated_at = now();

  return jsonb_build_object(
    'status', 'accepted',
    'remaining', greatest(0, workout_limit - current_count - 1)
  );
end;
$$;

revoke all on function public.reserve_workout_editor_request(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.reserve_workout_editor_request(uuid, uuid, text, text)
to service_role;
