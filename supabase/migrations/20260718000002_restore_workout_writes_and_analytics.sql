-- Restore PostgREST relationship inference and permit corrections to owned,
-- unlocked workouts after automatic completion.

-- The ownership FKs added in 20260718000001 supersede these single-column
-- FKs. Keeping both makes PostgREST embedded relationships ambiguous.
alter table public.workout_days
  drop constraint if exists workout_days_plan_id_fkey;
alter table public.workout_exercises
  drop constraint if exists workout_exercises_day_id_fkey;
alter table public.exercise_logs
  drop constraint if exists exercise_logs_exercise_id_fkey,
  drop constraint if exists exercise_logs_day_id_fkey;
alter table public.workout_day_logs
  drop constraint if exists workout_day_logs_day_id_fkey;
alter table public.plan_generation_requests
  drop constraint if exists plan_generation_requests_target_plan_id_fkey;
alter table public.coach_sessions
  drop constraint if exists coach_sessions_day_id_fkey;
alter table public.coach_tool_requests
  drop constraint if exists coach_tool_requests_day_id_fkey;
alter table public.workout_edit_messages
  drop constraint if exists workout_edit_messages_day_id_fkey;
alter table public.workout_edit_revisions
  drop constraint if exists workout_edit_revisions_day_id_fkey;

-- Users can correct their own unlocked workout results even if automatic
-- completion happened between two queued saves.
drop policy if exists exercise_logs_insert_own on public.exercise_logs;
drop policy if exists exercise_logs_update_own on public.exercise_logs;
drop policy if exists exercise_logs_delete_own on public.exercise_logs;

create policy exercise_logs_insert_own on public.exercise_logs
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.workout_exercises exercise
      join public.workout_days day on day.id = exercise.day_id
      where exercise.id = exercise_logs.exercise_id
        and exercise.day_id = exercise_logs.day_id
        and exercise.user_id = (select auth.uid())
        and day.user_id = (select auth.uid())
        and day.locked = false
    )
  );

create policy exercise_logs_update_own on public.exercise_logs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.workout_exercises exercise
      join public.workout_days day on day.id = exercise.day_id
      where exercise.id = exercise_logs.exercise_id
        and exercise.day_id = exercise_logs.day_id
        and exercise.user_id = (select auth.uid())
        and day.user_id = (select auth.uid())
        and day.locked = false
    )
  );

create policy exercise_logs_delete_own on public.exercise_logs
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.workout_days day
      where day.id = exercise_logs.day_id
        and day.user_id = (select auth.uid())
        and day.locked = false
    )
  );

create or replace function public.add_my_catalog_exercise(
  p_day_id uuid,
  p_catalog_exercise_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_day public.workout_days%rowtype;
  clip public.exercise_video_clips%rowtype;
  inserted_id uuid;
  next_order integer;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target_day
  from public.workout_days
  where id = p_day_id and user_id = caller
  for update;
  if not found or target_day.locked then
    raise exception 'Editable workout day not found' using errcode = '42501';
  end if;
  select * into clip
  from public.exercise_video_clips
  where id = p_catalog_exercise_id and active = true;
  if not found then raise exception 'Catalog exercise not found'; end if;
  if exists (
    select 1 from public.workout_exercises
    where day_id = p_day_id and user_id = caller and video_clip_id = clip.id
  ) then
    raise exception 'Exercise is already in this workout';
  end if;

  select coalesce(max(order_index), -1) + 1 into next_order
  from public.workout_exercises
  where day_id = p_day_id and user_id = caller;

  insert into public.workout_exercises (
    day_id, user_id, video_clip_id, order_index, name, category, instructions,
    sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels
  ) values (
    p_day_id, caller, clip.id, next_order, clip.exercise_name, clip.category,
    coalesce(clip.description, clip.coaching_notes), '2', null,
    case when clip.category in ('ball_handling', 'defense', 'conditioning') then '2 min' else '3 min' end,
    case when clip.category = 'shooting' then 10 when clip.category = 'finishing' then 8 else null end,
    case when clip.category = 'shooting' then 20 when clip.category = 'finishing' then 15 else null end,
    case
      when clip.category in ('shooting', 'finishing') then 'makes_attempts'
      when clip.category in ('ball_handling', 'defense', 'conditioning') then 'minutes'
      else 'checkbox'
    end,
    case when clip.requires_both_sides then array['left side', 'right side'] else null end
  )
  returning id into inserted_id;

  update public.workout_days
  set estimated_minutes = greatest(5, round(coalesce((
    select sum(
      coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::integer, 1)
      * coalesce(
          nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
          3
        )
    ) + 5 + count(*) * 1.5
    from public.workout_exercises exercise
    where exercise.day_id = p_day_id and exercise.user_id = caller
  ), 5))::integer)
  where id = p_day_id and user_id = caller;

  return inserted_id;
end;
$$;

create or replace function public.remove_my_workout_exercise(
  p_day_id uuid,
  p_exercise_id uuid
)
returns void
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
  perform 1
  from public.workout_days
  where id = p_day_id and user_id = caller and locked = false
  for update;
  if not found then
    raise exception 'Editable workout day not found' using errcode = '42501';
  end if;
  delete from public.workout_exercises
  where id = p_exercise_id and day_id = p_day_id and user_id = caller;
  if not found then raise exception 'Exercise not found' using errcode = '42501'; end if;

  update public.workout_days
  set estimated_minutes = greatest(5, round(coalesce((
    select sum(
      coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::integer, 1)
      * coalesce(
          nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
          3
        )
    ) + 5 + count(*) * 1.5
    from public.workout_exercises exercise
    where exercise.day_id = p_day_id and exercise.user_id = caller
  ), 5))::integer)
  where id = p_day_id and user_id = caller;
end;
$$;

revoke all on function public.add_my_catalog_exercise(uuid, uuid)
  from public, anon;
revoke all on function public.remove_my_workout_exercise(uuid, uuid)
  from public, anon;
grant execute on function public.add_my_catalog_exercise(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.remove_my_workout_exercise(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
