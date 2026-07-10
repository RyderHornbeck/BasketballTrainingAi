-- Row Level Security for all tables.
-- User-owned tables: users can only read/write their own rows.
-- exercise_video_clips: public read-only for authenticated users, no client writes.

alter table profiles enable row level security;
alter table onboarding_answers enable row level security;
alter table exercise_video_clips enable row level security;
alter table plan_generation_requests enable row level security;
alter table workout_plans enable row level security;
alter table workout_days enable row level security;
alter table workout_exercises enable row level security;
alter table exercise_logs enable row level security;
alter table workout_day_logs enable row level security;

-- ============================================================================
-- profiles
-- ============================================================================
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ============================================================================
-- onboarding_answers
-- ============================================================================
create policy "onboarding_answers_select_own"
  on onboarding_answers for select
  using (auth.uid() = user_id);

create policy "onboarding_answers_insert_own"
  on onboarding_answers for insert
  with check (auth.uid() = user_id);

create policy "onboarding_answers_update_own"
  on onboarding_answers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "onboarding_answers_delete_own"
  on onboarding_answers for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- exercise_video_clips: public read-only catalog for authenticated users.
-- No insert/update/delete policies are defined for the client -- only the
-- service role (used by the seed script and Edge Functions) can write.
-- ============================================================================
create policy "exercise_video_clips_select_authenticated"
  on exercise_video_clips for select
  to authenticated
  using (true);

-- ============================================================================
-- plan_generation_requests
-- ============================================================================
create policy "plan_generation_requests_select_own"
  on plan_generation_requests for select
  using (auth.uid() = user_id);

create policy "plan_generation_requests_insert_own"
  on plan_generation_requests for insert
  with check (auth.uid() = user_id);

create policy "plan_generation_requests_update_own"
  on plan_generation_requests for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- workout_plans
-- ============================================================================
create policy "workout_plans_select_own"
  on workout_plans for select
  using (auth.uid() = user_id);

create policy "workout_plans_insert_own"
  on workout_plans for insert
  with check (auth.uid() = user_id);

create policy "workout_plans_update_own"
  on workout_plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- workout_days
-- ============================================================================
create policy "workout_days_select_own"
  on workout_days for select
  using (auth.uid() = user_id);

create policy "workout_days_insert_own"
  on workout_days for insert
  with check (auth.uid() = user_id);

create policy "workout_days_update_own"
  on workout_days for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- workout_exercises
-- ============================================================================
create policy "workout_exercises_select_own"
  on workout_exercises for select
  using (auth.uid() = user_id);

create policy "workout_exercises_insert_own"
  on workout_exercises for insert
  with check (auth.uid() = user_id);

create policy "workout_exercises_update_own"
  on workout_exercises for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- exercise_logs
-- ============================================================================
create policy "exercise_logs_select_own"
  on exercise_logs for select
  using (auth.uid() = user_id);

create policy "exercise_logs_insert_own"
  on exercise_logs for insert
  with check (auth.uid() = user_id);

create policy "exercise_logs_update_own"
  on exercise_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "exercise_logs_delete_own"
  on exercise_logs for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- workout_day_logs
-- ============================================================================
create policy "workout_day_logs_select_own"
  on workout_day_logs for select
  using (auth.uid() = user_id);

create policy "workout_day_logs_insert_own"
  on workout_day_logs for insert
  with check (auth.uid() = user_id);

-- ============================================================================
-- Auto-create a profile row whenever a new auth user signs up.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
