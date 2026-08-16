-- External workout mutations do not pass through coach-tools. Normalize every
-- active session for this athlete/day to one new version as soon as the active
-- workout cursor changes, so reconnect leftovers cannot cause the live client
-- to adopt another session's higher version and reject its own future turns.
create or replace function public.version_coach_sessions_for_workout_cursor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_version integer;
begin
  select coalesce(max(session.state_version), 0) + 1
  into v_next_version
  from public.coach_sessions session
  where session.user_id = new.user_id
    and session.day_id = new.id
    and session.ended_at is null
    and session.expires_at > clock_timestamp();

  update public.coach_sessions
  set
    state_version = v_next_version,
    refreshed_at = clock_timestamp()
  where user_id = new.user_id
    and day_id = new.id
    and ended_at is null
    and expires_at > clock_timestamp();

  return new;
end;
$$;

drop trigger if exists workout_days_version_coach_cursor on public.workout_days;
create trigger workout_days_version_coach_cursor
after update of active_exercise_id, active_set_number on public.workout_days
for each row
when (
  old.active_exercise_id is distinct from new.active_exercise_id
  or old.active_set_number is distinct from new.active_set_number
)
execute function public.version_coach_sessions_for_workout_cursor();
