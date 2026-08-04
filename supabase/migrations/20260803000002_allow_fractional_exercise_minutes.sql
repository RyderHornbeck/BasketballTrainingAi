-- Timed sets can be shorter than one minute (for example, 30 seconds).
-- Preserve that exact progress instead of rejecting or rounding it.
alter table public.exercise_logs
  alter column minutes_completed type numeric
  using minutes_completed::numeric;
