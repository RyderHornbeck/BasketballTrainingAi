create or replace function public.reset_training_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Preserve auth.users and profiles identity fields so the same Google/Apple
  -- connection continues to sign in, while removing all training history.
  delete from public.coach_sessions where user_id = p_user_id;
  delete from public.coach_tool_requests where user_id = p_user_id;
  delete from public.coach_usage_logs where user_id = p_user_id;
  delete from public.coach_daily_usage where user_id = p_user_id;
  delete from public.workout_edit_messages where user_id = p_user_id;
  delete from public.workout_edit_revisions where user_id = p_user_id;
  delete from public.plan_generation_requests where user_id = p_user_id;
  delete from public.workout_plans where user_id = p_user_id;
  delete from public.user_achievements where user_id = p_user_id;
  delete from public.user_skill_rating_snapshots where user_id = p_user_id;
  delete from public.onboarding_answers where user_id = p_user_id;

  update public.profiles
  set
    onboarding_completed = false,
    push_token = null
  where id = p_user_id;
end;
$$;

revoke all on function public.reset_training_account(uuid) from public, anon, authenticated;
grant execute on function public.reset_training_account(uuid) to service_role;
notify pgrst, 'reload schema';
