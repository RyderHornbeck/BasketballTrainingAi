-- Defense-in-depth hardening for every application-owned API table.
-- Storage has no application buckets and Realtime has no published tables;
-- their existing deny-by-default posture is intentionally preserved.

-- ---------------------------------------------------------------------------
-- Ownership integrity and input validation
-- ---------------------------------------------------------------------------

alter table public.onboarding_answers alter column user_id set not null;
alter table public.plan_generation_requests alter column user_id set not null;
alter table public.workout_plans alter column user_id set not null;
alter table public.workout_days alter column plan_id set not null;
alter table public.workout_days alter column user_id set not null;
alter table public.workout_exercises alter column day_id set not null;
alter table public.workout_exercises alter column user_id set not null;
alter table public.exercise_logs alter column exercise_id set not null;
alter table public.exercise_logs alter column day_id set not null;
alter table public.exercise_logs alter column user_id set not null;
alter table public.workout_day_logs alter column day_id set not null;
alter table public.workout_day_logs alter column user_id set not null;

create unique index if not exists workout_plans_id_user_unique
  on public.workout_plans (id, user_id);
create unique index if not exists workout_days_id_user_unique
  on public.workout_days (id, user_id);
create unique index if not exists workout_exercises_id_day_user_unique
  on public.workout_exercises (id, day_id, user_id);

alter table public.workout_days
  add constraint workout_days_plan_owner_fkey
  foreign key (plan_id, user_id)
  references public.workout_plans (id, user_id)
  on delete cascade
  not valid;

alter table public.workout_exercises
  add constraint workout_exercises_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.exercise_logs
  add constraint exercise_logs_exercise_owner_fkey
  foreign key (exercise_id, day_id, user_id)
  references public.workout_exercises (id, day_id, user_id)
  on delete cascade
  not valid;

alter table public.workout_day_logs
  add constraint workout_day_logs_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.plan_generation_requests
  add constraint plan_generation_requests_target_owner_fkey
  foreign key (target_plan_id, user_id)
  references public.workout_plans (id, user_id)
  on delete cascade
  not valid;

alter table public.coach_sessions
  add constraint coach_sessions_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.coach_tool_requests
  add constraint coach_tool_requests_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.workout_edit_messages
  add constraint workout_edit_messages_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.workout_edit_revisions
  add constraint workout_edit_revisions_day_owner_fkey
  foreign key (day_id, user_id)
  references public.workout_days (id, user_id)
  on delete cascade
  not valid;

alter table public.workout_days validate constraint workout_days_plan_owner_fkey;
alter table public.workout_exercises validate constraint workout_exercises_day_owner_fkey;
alter table public.exercise_logs validate constraint exercise_logs_exercise_owner_fkey;
alter table public.workout_day_logs validate constraint workout_day_logs_day_owner_fkey;
alter table public.plan_generation_requests validate constraint plan_generation_requests_target_owner_fkey;
alter table public.coach_sessions validate constraint coach_sessions_day_owner_fkey;
alter table public.coach_tool_requests validate constraint coach_tool_requests_day_owner_fkey;
alter table public.workout_edit_messages validate constraint workout_edit_messages_day_owner_fkey;
alter table public.workout_edit_revisions validate constraint workout_edit_revisions_day_owner_fkey;

alter table public.profiles
  add constraint profiles_theme_allowed
  check (theme in ('light', 'dark', 'system')) not valid,
  add constraint profiles_full_name_length
  check (full_name is null or length(full_name) <= 200) not valid,
  add constraint profiles_timezone_length
  check (timezone is null or length(timezone) <= 100) not valid;
alter table public.profiles validate constraint profiles_theme_allowed;
alter table public.profiles validate constraint profiles_full_name_length;
alter table public.profiles validate constraint profiles_timezone_length;

alter table public.onboarding_answers
  add constraint onboarding_days_per_week_range
  check (days_per_week is null or days_per_week between 1 and 7) not valid,
  add constraint onboarding_minutes_per_workout_range
  check (minutes_per_workout is null or minutes_per_workout between 5 and 240) not valid,
  add constraint onboarding_injuries_length
  check (injuries_limitations is null or length(injuries_limitations) <= 2000) not valid,
  add constraint onboarding_overall_skill_allowed
  check (
    overall_skill_level is null
    or overall_skill_level in ('beginner', 'intermediate', 'advanced', 'elite')
  ) not valid,
  add constraint onboarding_position_allowed
  check (position is null or position in ('Guard', 'Wing', 'Big', 'Unknown')) not valid,
  add constraint onboarding_intensity_allowed
  check (
    preferred_intensity is null
    or preferred_intensity in ('Light', 'Medium', 'Hard', 'Extremely hard')
  ) not valid,
  add constraint onboarding_skill_ratings_allowed
  check (
    (shooting_level is null or shooting_level ~ '^(10|[0-9])$')
    and (ball_handling_level is null or ball_handling_level ~ '^(10|[0-9])$')
    and (finishing_level is null or finishing_level ~ '^(10|[0-9])$')
    and (defense_level is null or defense_level ~ '^(10|[0-9])$')
    and (basketball_iq_level is null or basketball_iq_level ~ '^(10|[0-9])$')
    and (conditioning_level is null or conditioning_level ~ '^(10|[0-9])$')
    and (athleticism_level is null or athleticism_level ~ '^(10|[0-9])$')
    and (strength_level is null or strength_level ~ '^(10|[0-9])$')
  ) not valid;
alter table public.onboarding_answers validate constraint onboarding_days_per_week_range;
alter table public.onboarding_answers validate constraint onboarding_minutes_per_workout_range;
alter table public.onboarding_answers validate constraint onboarding_injuries_length;
alter table public.onboarding_answers validate constraint onboarding_overall_skill_allowed;
alter table public.onboarding_answers validate constraint onboarding_position_allowed;
alter table public.onboarding_answers validate constraint onboarding_intensity_allowed;
alter table public.onboarding_answers validate constraint onboarding_skill_ratings_allowed;

alter table public.exercise_logs
  add constraint exercise_logs_nonnegative
  check (
    coalesce(makes, 0) >= 0
    and coalesce(attempts, 0) >= 0
    and coalesce(minutes_completed, 0) >= 0
  ) not valid,
  add constraint exercise_logs_reasonable_limits
  check (
    coalesce(makes, 0) <= 100000
    and coalesce(attempts, 0) <= 100000
    and coalesce(minutes_completed, 0) <= 1440
    and (notes is null or length(notes) <= 20000)
  ) not valid;
alter table public.exercise_logs validate constraint exercise_logs_nonnegative;
alter table public.exercise_logs validate constraint exercise_logs_reasonable_limits;

alter table public.workout_exercises
  add constraint workout_exercises_log_type_allowed
  check (
    log_type is null
    or log_type in ('makes_attempts', 'minutes', 'checkbox', 'difficulty_rating', 'notes')
  ) not valid,
  add constraint workout_exercises_targets_nonnegative
  check (coalesce(target_makes, 0) >= 0 and coalesce(target_attempts, 0) >= 0) not valid;
alter table public.workout_exercises validate constraint workout_exercises_log_type_allowed;
alter table public.workout_exercises validate constraint workout_exercises_targets_nonnegative;

alter table public.coach_tool_requests
  add column if not exists processing_status text not null default 'completed',
  add column if not exists updated_at timestamptz not null default now();
alter table public.coach_tool_requests
  add constraint coach_tool_requests_processing_status_allowed
  check (processing_status in ('processing', 'completed', 'failed')) not valid;
alter table public.coach_tool_requests validate constraint coach_tool_requests_processing_status_allowed;

create table if not exists public.workout_editor_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count between 0 and 50),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table public.workout_editor_daily_usage enable row level security;

-- Prevent an active drill from pointing at another workout or another user.
create or replace function public.validate_workout_active_exercise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_exercise_id is not null and not exists (
    select 1
    from public.workout_exercises exercise
    where exercise.id = new.active_exercise_id
      and exercise.day_id = new.id
      and exercise.user_id = new.user_id
  ) then
    raise exception 'active exercise must belong to this workout day';
  end if;
  return new;
end;
$$;

create or replace function public.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null and not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone
    where timezone.name = new.timezone
  ) then
    raise exception 'Invalid timezone';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_timezone on public.profiles;
create trigger profiles_validate_timezone
before insert or update of timezone on public.profiles
for each row execute function public.validate_profile_timezone();

drop trigger if exists workout_days_validate_active_exercise on public.workout_days;
create constraint trigger workout_days_validate_active_exercise
after insert or update of active_exercise_id, user_id
on public.workout_days
deferrable initially deferred
for each row execute function public.validate_workout_active_exercise();

-- ---------------------------------------------------------------------------
-- RLS: explicit authenticated-role policies, deny by default for every other
-- operation. Service-role operations continue to bypass RLS.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.onboarding_answers enable row level security;
alter table public.exercise_video_clips enable row level security;
alter table public.plan_generation_requests enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_days enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.exercise_logs enable row level security;
alter table public.workout_day_logs enable row level security;
alter table public.coach_sessions enable row level security;
alter table public.coach_tool_requests enable row level security;
alter table public.coach_usage_logs enable row level security;
alter table public.coach_daily_usage enable row level security;
alter table public.workout_edit_messages enable row level security;
alter table public.workout_edit_revisions enable row level security;
alter table public.workout_edit_operations enable row level security;
alter table public.user_achievements enable row level security;
alter table public.user_skill_rating_snapshots enable row level security;
alter table public.workout_editor_daily_usage enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists onboarding_answers_select_own on public.onboarding_answers;
drop policy if exists onboarding_answers_insert_own on public.onboarding_answers;
drop policy if exists onboarding_answers_update_own on public.onboarding_answers;
drop policy if exists onboarding_answers_delete_own on public.onboarding_answers;
create policy onboarding_answers_select_own on public.onboarding_answers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy onboarding_answers_insert_own on public.onboarding_answers
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy onboarding_answers_update_own on public.onboarding_answers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy onboarding_answers_delete_own on public.onboarding_answers
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists exercise_video_clips_select_authenticated on public.exercise_video_clips;
create policy exercise_video_clips_select_authenticated on public.exercise_video_clips
  for select to authenticated using (true);

drop policy if exists plan_generation_requests_select_own on public.plan_generation_requests;
drop policy if exists plan_generation_requests_insert_own on public.plan_generation_requests;
drop policy if exists plan_generation_requests_update_own on public.plan_generation_requests;
create policy plan_generation_requests_select_own on public.plan_generation_requests
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_plans_select_own on public.workout_plans;
drop policy if exists workout_plans_insert_own on public.workout_plans;
drop policy if exists workout_plans_update_own on public.workout_plans;
create policy workout_plans_select_own on public.workout_plans
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_days_select_own on public.workout_days;
drop policy if exists workout_days_insert_own on public.workout_days;
drop policy if exists workout_days_update_own on public.workout_days;
create policy workout_days_select_own on public.workout_days
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_exercises_select_own on public.workout_exercises;
drop policy if exists workout_exercises_insert_own on public.workout_exercises;
drop policy if exists workout_exercises_update_own on public.workout_exercises;
drop policy if exists workout_exercises_delete_own on public.workout_exercises;
create policy workout_exercises_select_own on public.workout_exercises
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists exercise_logs_select_own on public.exercise_logs;
drop policy if exists exercise_logs_insert_own on public.exercise_logs;
drop policy if exists exercise_logs_update_own on public.exercise_logs;
drop policy if exists exercise_logs_delete_own on public.exercise_logs;
create policy exercise_logs_select_own on public.exercise_logs
  for select to authenticated using ((select auth.uid()) = user_id);
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
        and day.completed = false
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
        and day.completed = false
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
        and day.completed = false
    )
  );

drop policy if exists workout_day_logs_select_own on public.workout_day_logs;
drop policy if exists workout_day_logs_insert_own on public.workout_day_logs;
create policy workout_day_logs_select_own on public.workout_day_logs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists coach_sessions_select_own on public.coach_sessions;
create policy coach_sessions_select_own on public.coach_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists coach_tool_requests_select_own on public.coach_tool_requests;
create policy coach_tool_requests_select_own on public.coach_tool_requests
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists coach_usage_logs_select_own on public.coach_usage_logs;
create policy coach_usage_logs_select_own on public.coach_usage_logs
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists coach_daily_usage_select_own on public.coach_daily_usage;
create policy coach_daily_usage_select_own on public.coach_daily_usage
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_edit_messages_select_own on public.workout_edit_messages;
drop policy if exists workout_edit_messages_insert_own on public.workout_edit_messages;
create policy workout_edit_messages_select_own on public.workout_edit_messages
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists workout_edit_revisions_select_own on public.workout_edit_revisions;
create policy workout_edit_revisions_select_own on public.workout_edit_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists workout_edit_operations_select_own on public.workout_edit_operations;
create policy workout_edit_operations_select_own on public.workout_edit_operations
  for select to authenticated
  using (
    exists (
      select 1
      from public.workout_edit_revisions revision
      where revision.id = revision_id
        and revision.user_id = (select auth.uid())
    )
  );

drop policy if exists user_achievements_select_own on public.user_achievements;
create policy user_achievements_select_own on public.user_achievements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_skill_rating_snapshots_select_own
  on public.user_skill_rating_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Authenticated RPCs for sensitive state transitions.
-- ---------------------------------------------------------------------------

create or replace function public.complete_my_onboarding()
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
  if not exists (
    select 1 from public.onboarding_answers where user_id = caller
  ) then
    raise exception 'Onboarding answers are required';
  end if;
  update public.profiles
  set onboarding_completed = true
  where id = caller;
end;
$$;

create or replace function public.increment_coach_session_response(
  p_session_id uuid,
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.coach_sessions
  set response_count = response_count + 1
  where id = p_session_id
    and user_id = p_user_id
    and ended_at is null
    and expires_at > now();
$$;

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
begin
  if p_user_id is null
    or p_request_id is null
    or length(p_request_id) not between 8 and 200
    or p_message is null
    or length(p_message) not between 1 and 1200 then
    raise exception 'Invalid workout editor request';
  end if;
  if not exists (
    select 1 from public.workout_days
    where id = p_day_id and user_id = p_user_id
  ) then
    raise exception 'Workout day not found' using errcode = '42501';
  end if;

  select profile.timezone into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1
      from pg_catalog.pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into public.workout_editor_daily_usage (user_id, usage_date)
  values (p_user_id, local_date)
  on conflict (user_id, usage_date) do nothing;

  select usage.request_count into current_count
  from public.workout_editor_daily_usage usage
  where usage.user_id = p_user_id and usage.usage_date = local_date
  for update;

  if exists (
    select 1
    from public.workout_edit_messages
    where user_id = p_user_id and request_id = p_request_id
  ) then
    return jsonb_build_object(
      'status', 'duplicate',
      'remaining', greatest(0, 50 - current_count)
    );
  end if;
  if current_count >= 50 then
    return jsonb_build_object('status', 'limit', 'remaining', 0);
  end if;

  insert into public.workout_edit_messages (
    user_id, day_id, role, content, request_id
  ) values (
    p_user_id, p_day_id, 'user', p_message, p_request_id
  );
  update public.workout_editor_daily_usage
  set request_count = request_count + 1, updated_at = now()
  where user_id = p_user_id and usage_date = local_date;
  return jsonb_build_object(
    'status', 'accepted',
    'remaining', greatest(0, 49 - current_count)
  );
end;
$$;

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
  if p_block_index is null or p_block_index < 1 or p_block_index > 100 then
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

create or replace function public.finish_my_workout_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_day public.workout_days%rowtype;
  completion text;
  trained_minutes integer;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
  into target_day
  from public.workout_days
  where id = p_day_id and user_id = caller
  for update;
  if not found then
    raise exception 'Workout day not found' using errcode = '42501';
  end if;
  if target_day.completed then return; end if;
  if target_day.locked then
    raise exception 'Workout day is locked' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.workout_days previous
    where previous.plan_id = target_day.plan_id
      and previous.day_number = target_day.day_number - 1
      and previous.completed = false
  ) then
    raise exception 'Previous workout must be completed first' using errcode = '42501';
  end if;

  completion := case when exists (
    select 1
    from public.workout_exercises exercise
    left join public.exercise_logs log
      on log.exercise_id = exercise.id
     and log.user_id = caller
    where exercise.day_id = target_day.id
      and exercise.user_id = caller
      and coalesce(log.completed, false) = false
  ) then 'partial' else 'full' end;

  select coalesce(sum(greatest(0, coalesce(log.minutes_completed, 0))), 0)::integer
  into trained_minutes
  from public.exercise_logs log
  where log.day_id = target_day.id
    and log.user_id = caller;
  if trained_minutes = 0 then
    trained_minutes := greatest(1, coalesce(target_day.estimated_minutes, 1));
  end if;

  insert into public.workout_day_logs (day_id, user_id, completed_at, total_minutes)
  values (target_day.id, caller, now(), trained_minutes)
  on conflict (day_id) do update
  set completed_at = excluded.completed_at,
      total_minutes = excluded.total_minutes;

  update public.workout_days
  set completed = true,
      locked = false,
      completion_kind = completion,
      finalized_at = now()
  where id = target_day.id and user_id = caller;

  update public.workout_days
  set locked = false, scheduled_date = null
  where plan_id = target_day.plan_id
    and user_id = caller
    and day_number = target_day.day_number + 1;
end;
$$;

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
  if not found or target_day.completed then
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
  where id = p_day_id and user_id = caller and completed = false
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

create or replace function public.reset_training_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.coach_sessions where user_id = p_user_id;
  delete from public.coach_tool_requests where user_id = p_user_id;
  delete from public.coach_usage_logs where user_id = p_user_id;
  delete from public.coach_daily_usage where user_id = p_user_id;
  delete from public.workout_editor_daily_usage where user_id = p_user_id;
  delete from public.workout_edit_messages where user_id = p_user_id;
  delete from public.workout_edit_revisions where user_id = p_user_id;
  delete from public.plan_generation_requests where user_id = p_user_id;
  delete from public.workout_plans where user_id = p_user_id;
  delete from public.user_achievements where user_id = p_user_id;
  delete from public.user_skill_rating_snapshots where user_id = p_user_id;
  delete from public.onboarding_answers where user_id = p_user_id;
  update public.profiles
  set onboarding_completed = false, push_token = null
  where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege grants. RLS is not a substitute for object privileges.
-- ---------------------------------------------------------------------------

revoke all privileges on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

grant select on public.profiles to authenticated;
grant update (theme, timezone, full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.onboarding_answers to authenticated;
grant select on public.exercise_video_clips to authenticated;
grant select on public.plan_generation_requests to authenticated;
grant select on public.workout_plans to authenticated;
grant select on public.workout_days to authenticated;
grant select on public.workout_exercises to authenticated;
grant select, insert, update, delete on public.exercise_logs to authenticated;
grant select on public.workout_day_logs to authenticated;
grant select on public.coach_sessions to authenticated;
grant select on public.coach_tool_requests to authenticated;
grant select on public.coach_usage_logs to authenticated;
grant select on public.coach_daily_usage to authenticated;
grant select on public.workout_edit_messages to authenticated;
grant select on public.workout_edit_revisions to authenticated;
grant select on public.workout_edit_operations to authenticated;
grant select on public.user_achievements to authenticated;
grant select on public.user_skill_rating_snapshots to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.complete_my_onboarding() to authenticated;
grant execute on function public.create_my_plan_generation_request(text, uuid, integer) to authenticated;
grant execute on function public.finish_my_workout_day(uuid) to authenticated;
grant execute on function public.add_my_catalog_exercise(uuid, uuid) to authenticated;
grant execute on function public.remove_my_workout_exercise(uuid, uuid) to authenticated;
grant execute on function public.evaluate_my_achievements() to authenticated;
grant execute on function public.get_my_coach_daily_usage() to authenticated;
grant execute on all functions in schema public to service_role;

-- Trigger functions never need API-role EXECUTE.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refresh_achievements_from_activity() from public, anon, authenticated;
revoke execute on function public.touch_workout_activity_from_exercise_log() from public, anon, authenticated;
revoke execute on function public.set_workout_completion_metadata() from public, anon, authenticated;
revoke execute on function public.set_workout_log_activity_date() from public, anon, authenticated;
revoke execute on function public.validate_workout_active_exercise() from public, anon, authenticated;
revoke execute on function public.validate_profile_timezone() from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
