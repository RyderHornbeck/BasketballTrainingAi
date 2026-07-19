alter table public.user_skill_rating_snapshots
  add column if not exists shooting_rating integer check (shooting_rating between 0 and 100),
  add column if not exists ball_handling_rating integer check (ball_handling_rating between 0 and 100),
  add column if not exists finishing_rating integer check (finishing_rating between 0 and 100),
  add column if not exists defense_rating integer check (defense_rating between 0 and 100),
  add column if not exists conditioning_rating integer check (conditioning_rating between 0 and 100),
  add column if not exists discipline_rating integer check (discipline_rating between 0 and 100);
