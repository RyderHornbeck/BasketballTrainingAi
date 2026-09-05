create table if not exists public.workout_editor_debug_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null references public.workout_days(id) on delete cascade,
  request_id text not null,
  stage text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workout_editor_debug_traces_lookup_idx
  on public.workout_editor_debug_traces (user_id, day_id, created_at desc);

alter table public.workout_editor_debug_traces enable row level security;
