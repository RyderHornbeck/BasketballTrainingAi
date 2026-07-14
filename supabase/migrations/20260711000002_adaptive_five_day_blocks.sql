-- Rolling five-workout blocks and generation idempotency.

alter table plan_generation_requests
  add column if not exists generation_type text not null default 'initial'
    check (generation_type in ('initial', 'extend')),
  add column if not exists target_plan_id uuid references workout_plans(id) on delete cascade,
  add column if not exists block_index int not null default 1
    check (block_index > 0);

alter table workout_days
  add column if not exists block_index int not null default 1
    check (block_index > 0);

create unique index if not exists idx_workout_days_plan_day_unique
  on workout_days(plan_id, day_number);

create unique index if not exists idx_plan_generation_requests_active_user
  on plan_generation_requests(user_id)
  where status in ('pending', 'generating');

create unique index if not exists idx_plan_generation_requests_plan_block
  on plan_generation_requests(target_plan_id, block_index)
  where target_plan_id is not null and status <> 'failed';

create index if not exists idx_workout_days_plan_block
  on workout_days(plan_id, block_index, day_number);

delete from workout_day_logs
where id in (
  select id
  from (
    select
      id,
      row_number() over (partition by day_id order by completed_at asc, id asc) as duplicate_number
    from workout_day_logs
  ) duplicates
  where duplicate_number > 1
);

create unique index if not exists idx_workout_day_logs_day_unique
  on workout_day_logs(day_id);
