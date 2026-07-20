alter table public.user_skill_rating_snapshots
  add column if not exists workouts_completed integer
    check (workouts_completed is null or workouts_completed >= 0);
