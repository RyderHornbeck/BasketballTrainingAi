-- Preserve the playing-level answer separately from overall skill level.
alter table public.onboarding_answers
  add column if not exists playing_level text;
