create or replace function public.remove_my_exercise_set(
  p_day_id uuid,
  p_exercise_id uuid,
  p_set_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_exercise public.workout_exercises%rowtype;
  v_count integer;
  v_sides text[];
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  select * into v_exercise from public.workout_exercises
  where id = p_exercise_id and day_id = p_day_id and user_id = v_user_id for update;
  if not found then raise exception 'Workout exercise not found'; end if;
  v_count := greatest(1, coalesce(nullif(regexp_replace(coalesce(v_exercise.sets, '1'), '\D.*$', ''), '')::integer, 1));
  if v_count <= 1 then raise exception 'A drill must have at least one set'; end if;
  if p_set_number < 1 or p_set_number > v_count then raise exception 'Invalid set number'; end if;
  v_sides := v_exercise.set_side_labels;
  if v_sides is not null then v_sides := array_remove(v_sides, v_sides[p_set_number]); end if;
  update public.workout_exercises
  set sets = (v_count - 1)::text, set_side_labels = v_sides
  where id = v_exercise.id;
  update public.workout_days
  set completed = false,
      active_exercise_id = v_exercise.id,
      active_set_number = least(coalesce(active_set_number, 1), v_count - 1)
  where id = p_day_id and user_id = v_user_id;
end;
$$;
grant execute on function public.remove_my_exercise_set(uuid, uuid, integer) to authenticated;
