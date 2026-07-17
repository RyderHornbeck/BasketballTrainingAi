create policy "workout_exercises_delete_own"
  on workout_exercises for delete
  using (auth.uid() = user_id);

create table if not exists workout_edit_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null references workout_days(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  request_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_workout_edit_messages_request
  on workout_edit_messages(user_id, request_id)
  where request_id is not null;

create index if not exists idx_workout_edit_messages_day_created
  on workout_edit_messages(day_id, created_at);

alter table workout_edit_messages enable row level security;

create policy "workout_edit_messages_select_own"
  on workout_edit_messages for select
  using (auth.uid() = user_id);

create policy "workout_edit_messages_insert_own"
  on workout_edit_messages for insert
  with check (auth.uid() = user_id);

-- Repair active workout estimates that counted only drill work and omitted
-- setup, water, and transitions. Keep the result within the user's requested
-- workout length for generated plans.
with latest_answers as (
  select distinct on (user_id) user_id, minutes_per_workout
  from onboarding_answers
  order by user_id, created_at desc
),
exercise_estimates as (
  select
    day.id as day_id,
    answers.minutes_per_workout,
    sum(
      coalesce(nullif(substring(exercise.sets from '[0-9]+'), '')::int, 1) *
      coalesce(
        nullif(substring(exercise.duration from '([0-9]+(\.[0-9]+)?)\s*min'), '')::numeric,
        3
      )
    ) + 5 + count(exercise.id) * 1.5 as estimated_minutes
  from workout_days day
  join workout_exercises exercise on exercise.day_id = day.id
  left join latest_answers answers on answers.user_id = day.user_id
  where day.completed = false
  group by day.id, answers.minutes_per_workout
)
update workout_days day
set estimated_minutes = greatest(
  10,
  round(
    least(
      coalesce(exercise_estimates.minutes_per_workout, exercise_estimates.estimated_minutes),
      exercise_estimates.estimated_minutes
    )
  )
)::int
from exercise_estimates
where day.id = exercise_estimates.day_id;
