alter table workout_days
  add column if not exists active_exercise_id uuid
  references workout_exercises(id) on delete set null;

create index if not exists idx_workout_days_active_exercise_id
  on workout_days(active_exercise_id);
