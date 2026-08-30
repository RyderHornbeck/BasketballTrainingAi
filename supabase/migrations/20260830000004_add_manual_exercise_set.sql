create or replace function public.append_my_exercise_set(
  p_day_id uuid,
  p_exercise_id uuid
)
returns table(state_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_exercise public.workout_exercises%rowtype;
  v_count integer;
  v_sides jsonb;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  select * into v_exercise from public.workout_exercises
  where id = p_exercise_id and day_id = p_day_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Workout exercise not found'; end if;
  v_count := greatest(1, coalesce(nullif(regexp_replace(coalesce(v_exercise.sets, '1'), '\D.*$', ''), '')::integer, 1));
  if v_count >= 100 then raise exception 'A drill can have at most 100 sets'; end if;
  v_sides := coalesce(to_jsonb(v_exercise.set_side_labels), '[]'::jsonb);
  if jsonb_array_length(v_sides) > 0 then
    v_sides := v_sides || to_jsonb(case when (v_count + 1) % 2 = 1 then 'Right side' else 'Left side' end);
  end if;
  update public.workout_exercises
  set sets = (v_count + 1)::text,
      set_side_labels = case when jsonb_array_length(v_sides) > 0 then array(select jsonb_array_elements_text(v_sides)) else null end
  where id = v_exercise.id;
  update public.workout_days
  set completed = false, active_exercise_id = v_exercise.id, active_set_number = v_count + 1
  where id = p_day_id and user_id = v_user_id;
  return query select coalesce((
    select max(session_row.state_version)
    from public.coach_sessions as session_row
    where session_row.day_id = p_day_id and session_row.user_id = v_user_id
  ), 0);
end;
$$;

grant execute on function public.append_my_exercise_set(uuid, uuid) to authenticated;
