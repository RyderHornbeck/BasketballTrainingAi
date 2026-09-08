-- Keep manual drill additions aligned with generated workouts and provide an
-- atomic, category-safe replacement operation for the workout drill menu.

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
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target_day from public.workout_days
  where id = p_day_id and user_id = caller for update;
  if not found or target_day.completed then raise exception 'Editable workout day not found' using errcode = '42501'; end if;
  select * into clip from public.exercise_video_clips where id = p_catalog_exercise_id and active = true;
  if not found then raise exception 'Catalog exercise not found'; end if;
  if exists (select 1 from public.workout_exercises where day_id = p_day_id and user_id = caller and video_clip_id = clip.id) then
    raise exception 'Exercise is already in this workout';
  end if;

  select coalesce(max(order_index), -1) + 1 into next_order
  from public.workout_exercises where day_id = p_day_id and user_id = caller;

  insert into public.workout_exercises (
    day_id, user_id, video_clip_id, order_index, name, category, instructions,
    sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels
  ) values (
    p_day_id, caller, clip.id, next_order, clip.exercise_name, clip.category,
    coalesce(clip.description, clip.coaching_notes), '2', null,
    case when clip.category = 'ball_handling' then '30 sec' else '3 min' end,
    case when clip.category = 'shooting' then 10 when clip.category = 'finishing' then 8 else null end,
    case when clip.category = 'shooting' then 20 when clip.category = 'finishing' then 15 else null end,
    case when clip.category in ('shooting', 'finishing') then 'makes_attempts' else 'minutes' end,
    case when clip.requires_both_sides then array['right side', 'left side'] else null end
  ) returning id into inserted_id;

  update public.workout_days
  set estimated_minutes = greatest(5, round(coalesce((
    select sum(
      coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::integer, 1) *
      coalesce(
        nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
        nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*(sec|second)'), '')::numeric / 60,
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

create or replace function public.swap_my_workout_exercise(
  p_day_id uuid,
  p_exercise_id uuid,
  p_catalog_exercise_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_day public.workout_days%rowtype;
  source_exercise public.workout_exercises%rowtype;
  replacement public.exercise_video_clips%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target_day from public.workout_days
  where id = p_day_id and user_id = caller for update;
  if not found or target_day.completed then raise exception 'Editable workout day not found' using errcode = '42501'; end if;
  select * into source_exercise from public.workout_exercises
  where id = p_exercise_id and day_id = p_day_id and user_id = caller for update;
  if not found then raise exception 'Exercise not found' using errcode = '42501'; end if;
  select * into replacement from public.exercise_video_clips
  where id = p_catalog_exercise_id and active = true;
  if not found then raise exception 'Catalog exercise not found'; end if;
  if replacement.category <> source_exercise.category then raise exception 'Replacement must be in the same category'; end if;
  if replacement.id = source_exercise.video_clip_id then raise exception 'Choose a different drill'; end if;
  if exists (
    select 1 from public.workout_exercises
    where day_id = p_day_id and user_id = caller and video_clip_id = replacement.id and id <> p_exercise_id
  ) then raise exception 'Exercise is already in this workout'; end if;

  -- A replacement is a fresh drill. Discard prior set progress rather than
  -- attaching makes, attempts, or timer completion to a different exercise.
  delete from public.exercise_logs
  where exercise_id = p_exercise_id and day_id = p_day_id and user_id = caller;

  update public.workout_exercises
  set video_clip_id = replacement.id,
      name = replacement.exercise_name,
      instructions = coalesce(replacement.description, replacement.coaching_notes),
      sets = '2',
      reps = null,
      duration = case when replacement.category = 'ball_handling' then '30 sec' else '3 min' end,
      target_makes = case when replacement.category = 'shooting' then 10 when replacement.category = 'finishing' then 8 else null end,
      target_attempts = case when replacement.category = 'shooting' then 20 when replacement.category = 'finishing' then 15 else null end,
      log_type = case when replacement.category in ('shooting', 'finishing') then 'makes_attempts' else 'minutes' end,
      set_side_labels = case when replacement.requires_both_sides then array['right side', 'left side'] else null end
  where id = p_exercise_id;

  update public.workout_days
  set estimated_minutes = greatest(5, round(coalesce((
    select sum(
      coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::integer, 1) *
      coalesce(
        nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
        nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*(sec|second)'), '')::numeric / 60,
        3
      )
    ) + 5 + count(*) * 1.5
    from public.workout_exercises exercise
    where exercise.day_id = p_day_id and exercise.user_id = caller
  ), 5))::integer)
  where id = p_day_id and user_id = caller;
end;
$$;

grant execute on function public.swap_my_workout_exercise(uuid, uuid, uuid) to authenticated;
