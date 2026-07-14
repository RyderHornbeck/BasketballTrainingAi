-- Coach usage tracking, session limits, and idempotent tool requests.

create table if not exists coach_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null references workout_days(id) on delete cascade,
  session_key text not null,
  model text,
  response_count int not null default 0,
  workout_response_count int not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  constraint coach_sessions_session_key_unique unique (session_key)
);

create index if not exists idx_coach_sessions_user_day on coach_sessions(user_id, day_id);
create index if not exists idx_coach_sessions_active on coach_sessions(user_id, ended_at) where ended_at is null;

create table if not exists coach_tool_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null references workout_days(id) on delete cascade,
  client_request_id text not null,
  tool_name text not null,
  result text not null,
  db_changed boolean not null default false,
  client_action jsonb,
  local_confirmation text,
  skip_model_response boolean not null default false,
  created_at timestamptz not null default now(),
  constraint coach_tool_requests_idempotent unique (user_id, client_request_id)
);

create index if not exists idx_coach_tool_requests_user on coach_tool_requests(user_id, created_at desc);

create table if not exists coach_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid references workout_days(id) on delete set null,
  session_key text not null,
  model text,
  response_count int not null default 0,
  session_duration_ms int not null default 0,
  input_text_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  input_audio_tokens int not null default 0,
  output_text_tokens int not null default 0,
  output_audio_tokens int not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_coach_usage_logs_user_day on coach_usage_logs(user_id, created_at desc);

alter table coach_sessions enable row level security;
alter table coach_tool_requests enable row level security;
alter table coach_usage_logs enable row level security;

create policy "coach_sessions_select_own"
  on coach_sessions for select
  using (auth.uid() = user_id);

create policy "coach_tool_requests_select_own"
  on coach_tool_requests for select
  using (auth.uid() = user_id);

create policy "coach_usage_logs_select_own"
  on coach_usage_logs for select
  using (auth.uid() = user_id);
