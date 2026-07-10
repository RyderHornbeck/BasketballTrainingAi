-- HoopPlan initial schema
-- Core tables for profiles, onboarding, exercise catalog, plans, days, exercises, and logs.

create extension if not exists "pgcrypto";

-- ============================================================================
-- profiles
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now(),
  onboarding_completed boolean default false,
  push_token text,
  theme text default 'system'
);

-- ============================================================================
-- onboarding_answers
-- ============================================================================
create table if not exists onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  overall_skill_level text,
  main_goal text,
  position text,
  strengths text,
  weaknesses text,
  shooting_level text,
  ball_handling_level text,
  finishing_level text,
  defense_level text,
  basketball_iq_level text,
  conditioning_level text,
  athleticism_level text,
  strength_level text,
  days_per_week int,
  minutes_per_workout int,
  has_court_access boolean,
  equipment text[],
  injuries_limitations text,
  preferred_intensity text,
  created_at timestamptz default now()
);

create index if not exists idx_onboarding_answers_user_id on onboarding_answers(user_id);

-- ============================================================================
-- exercise_video_clips
-- ============================================================================
create table if not exists exercise_video_clips (
  id uuid primary key default gen_random_uuid(),

  exercise_name text not null,
  category text not null check (
    category in (
      'shooting',
      'ball_handling',
      'finishing',
      'defense',
      'footwork',
      'conditioning',
      'strength',
      'warmup',
      'cooldown',
      'mobility',
      'basketball_iq'
    )
  ),

  difficulty_level text check (
    difficulty_level in (
      'beginner',
      'intermediate',
      'advanced',
      'elite'
    )
  ),

  youtube_url text not null,
  youtube_video_id text not null,
  start_seconds int not null check (start_seconds >= 0),
  end_seconds int check (end_seconds is null or end_seconds > start_seconds),

  description text,
  coaching_notes text,

  skill_levels text[],
  goals text[],
  weaknesses text[],
  equipment text[],
  positions text[],

  source_section text,
  source_order int,

  active boolean default true,
  created_at timestamptz default now(),

  constraint unique_video_clip unique (
    youtube_video_id,
    start_seconds,
    exercise_name
  )
);

create index if not exists idx_exercise_video_clips_category on exercise_video_clips(category);
create index if not exists idx_exercise_video_clips_difficulty on exercise_video_clips(difficulty_level);
create index if not exists idx_exercise_video_clips_active on exercise_video_clips(active);

-- ============================================================================
-- plan_generation_requests
-- ============================================================================
create table if not exists plan_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  status text default 'pending' check (
    status in ('pending', 'generating', 'completed', 'failed')
  ),
  error_message text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_plan_generation_requests_user_id on plan_generation_requests(user_id);

-- ============================================================================
-- workout_plans
-- ============================================================================
create table if not exists workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text,
  summary text,
  duration_weeks int,
  days_per_week int,
  created_at timestamptz default now(),
  active boolean default true
);

create index if not exists idx_workout_plans_user_id on workout_plans(user_id);
create index if not exists idx_workout_plans_active on workout_plans(active);

-- ============================================================================
-- workout_days
-- ============================================================================
create table if not exists workout_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references workout_plans(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  day_number int,
  title text,
  focus text,
  estimated_minutes int,
  coach_notes text,
  locked boolean default true,
  completed boolean default false,
  scheduled_date date,
  created_at timestamptz default now()
);

create index if not exists idx_workout_days_plan_id on workout_days(plan_id);
create index if not exists idx_workout_days_user_id on workout_days(user_id);

-- ============================================================================
-- workout_exercises
-- ============================================================================
create table if not exists workout_exercises (
  id uuid primary key default gen_random_uuid(),
  day_id uuid references workout_days(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  video_clip_id uuid references exercise_video_clips(id),
  order_index int,
  name text,
  category text,
  instructions text,
  sets text,
  reps text,
  duration text,
  target_makes int,
  target_attempts int,
  log_type text,
  created_at timestamptz default now()
);

create index if not exists idx_workout_exercises_day_id on workout_exercises(day_id);
create index if not exists idx_workout_exercises_user_id on workout_exercises(user_id);

-- ============================================================================
-- exercise_logs
-- ============================================================================
create table if not exists exercise_logs (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid references workout_exercises(id) on delete cascade,
  day_id uuid references workout_days(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  completed boolean default false,
  makes int,
  attempts int,
  minutes_completed int,
  difficulty int check (difficulty is null or (difficulty >= 1 and difficulty <= 5)),
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_exercise_logs_day_id on exercise_logs(day_id);
create index if not exists idx_exercise_logs_user_id on exercise_logs(user_id);
create index if not exists idx_exercise_logs_exercise_id on exercise_logs(exercise_id);

-- ============================================================================
-- workout_day_logs
-- ============================================================================
create table if not exists workout_day_logs (
  id uuid primary key default gen_random_uuid(),
  day_id uuid references workout_days(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  completed_at timestamptz default now(),
  total_minutes int
);

create index if not exists idx_workout_day_logs_day_id on workout_day_logs(day_id);
create index if not exists idx_workout_day_logs_user_id on workout_day_logs(user_id);
