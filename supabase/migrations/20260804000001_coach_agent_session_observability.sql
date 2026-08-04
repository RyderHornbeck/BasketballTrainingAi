-- Add provider-neutral voice session metadata and append-only observability
-- ledgers without changing the existing Realtime session contract.

alter table public.coach_sessions
  add column if not exists provider text,
  add column if not exists provider_session_id text,
  add column if not exists voice_persona text,
  add column if not exists state_version integer not null default 0,
  add column if not exists refreshed_at timestamptz;

update public.coach_sessions
set provider = coalesce(provider, 'openai'),
    refreshed_at = coalesce(refreshed_at, started_at)
where provider is null or refreshed_at is null;

alter table public.coach_sessions
  alter column provider set default 'openai',
  alter column refreshed_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_sessions_provider_length'
      and conrelid = 'public.coach_sessions'::regclass
  ) then
    alter table public.coach_sessions
      add constraint coach_sessions_provider_length
      check (provider is null or length(provider) between 1 and 40) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_sessions_state_version_nonnegative'
      and conrelid = 'public.coach_sessions'::regclass
  ) then
    alter table public.coach_sessions
      add constraint coach_sessions_state_version_nonnegative
      check (state_version >= 0) not valid;
  end if;
end
$$;

alter table public.coach_sessions
  validate constraint coach_sessions_provider_length;
alter table public.coach_sessions
  validate constraint coach_sessions_state_version_nonnegative;

create index if not exists idx_coach_sessions_provider_active
  on public.coach_sessions (provider, refreshed_at desc)
  where ended_at is null;

create table if not exists public.coach_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coach_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null,
  provider text not null check (length(provider) between 1 and 40),
  event_type text not null check (length(event_type) between 1 and 80),
  provider_request_id text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_coach_session_events_session_time
  on public.coach_session_events (session_id, occurred_at desc);
create index if not exists idx_coach_session_events_user_time
  on public.coach_session_events (user_id, occurred_at desc);

create table if not exists public.coach_agent_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coach_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null,
  provider text not null check (length(provider) between 1 and 40),
  turn_key text not null check (length(turn_key) between 1 and 128),
  sequence_number integer not null check (sequence_number >= 0),
  status text not null default 'started'
    check (status in ('started', 'completed', 'failed', 'cancelled')),
  input_chars integer not null default 0 check (input_chars >= 0),
  output_chars integer not null default 0 check (output_chars >= 0),
  stt_latency_ms integer check (stt_latency_ms is null or stt_latency_ms >= 0),
  agent_latency_ms integer check (agent_latency_ms is null or agent_latency_ms >= 0),
  tts_latency_ms integer check (tts_latency_ms is null or tts_latency_ms >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (session_id, turn_key),
  unique (session_id, sequence_number)
);

create index if not exists idx_coach_agent_turns_user_time
  on public.coach_agent_turns (user_id, started_at desc);

create table if not exists public.coach_provider_usage (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coach_sessions(id) on delete cascade,
  turn_id uuid references public.coach_agent_turns(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid not null,
  provider text not null check (length(provider) between 1 and 40),
  provider_request_id text not null check (length(provider_request_id) between 1 and 160),
  metric text not null check (length(metric) between 1 and 80),
  quantity numeric(16, 4) not null default 0 check (quantity >= 0),
  unit text not null check (length(unit) between 1 and 40),
  estimated_cost_usd numeric(12, 8) not null default 0
    check (estimated_cost_usd >= 0),
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (session_id, provider_request_id, metric)
);

create unique index if not exists idx_coach_sessions_id_user
  on public.coach_sessions (id, user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_session_events_session_owner_fkey'
      and conrelid = 'public.coach_session_events'::regclass
  ) then
    alter table public.coach_session_events
      add constraint coach_session_events_session_owner_fkey
      foreign key (session_id, user_id)
      references public.coach_sessions (id, user_id)
      on delete cascade not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_agent_turns_session_owner_fkey'
      and conrelid = 'public.coach_agent_turns'::regclass
  ) then
    alter table public.coach_agent_turns
      add constraint coach_agent_turns_session_owner_fkey
      foreign key (session_id, user_id)
      references public.coach_sessions (id, user_id)
      on delete cascade not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_provider_usage_session_owner_fkey'
      and conrelid = 'public.coach_provider_usage'::regclass
  ) then
    alter table public.coach_provider_usage
      add constraint coach_provider_usage_session_owner_fkey
      foreign key (session_id, user_id)
      references public.coach_sessions (id, user_id)
      on delete cascade not valid;
  end if;
end
$$;

alter table public.coach_session_events
  validate constraint coach_session_events_session_owner_fkey;
alter table public.coach_agent_turns
  validate constraint coach_agent_turns_session_owner_fkey;
alter table public.coach_provider_usage
  validate constraint coach_provider_usage_session_owner_fkey;

create index if not exists idx_coach_provider_usage_user_time
  on public.coach_provider_usage (user_id, observed_at desc);
create index if not exists idx_coach_provider_usage_session
  on public.coach_provider_usage (session_id, observed_at desc);

alter table public.coach_session_events enable row level security;
alter table public.coach_agent_turns enable row level security;
alter table public.coach_provider_usage enable row level security;

drop policy if exists coach_session_events_select_own on public.coach_session_events;
create policy coach_session_events_select_own on public.coach_session_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists coach_agent_turns_select_own on public.coach_agent_turns;
create policy coach_agent_turns_select_own on public.coach_agent_turns
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists coach_provider_usage_select_own on public.coach_provider_usage;
create policy coach_provider_usage_select_own on public.coach_provider_usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.coach_session_events from public, anon, authenticated;
revoke all on table public.coach_agent_turns from public, anon, authenticated;
revoke all on table public.coach_provider_usage from public, anon, authenticated;
grant select on table public.coach_session_events to authenticated;
grant select on table public.coach_agent_turns to authenticated;
grant select on table public.coach_provider_usage to authenticated;
grant all on table public.coach_session_events to service_role;
grant all on table public.coach_agent_turns to service_role;
grant all on table public.coach_provider_usage to service_role;

create or replace function public.bootstrap_coach_agent_session(
  p_user_id uuid,
  p_day_id uuid,
  p_session_key text,
  p_provider text,
  p_model text,
  p_voice_persona text,
  p_state_version integer default 0
)
returns table (
  session_id uuid,
  started_at timestamptz,
  refreshed_at timestamptz,
  expires_at timestamptz,
  state_version integer,
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric,
  allowed boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_session public.coach_sessions%rowtype;
  active_session public.coach_sessions%rowtype;
  local_timezone text := 'UTC';
  local_date date;
  current_spent numeric := 0;
  daily_budget constant numeric := 0.75;
  current_time timestamptz := clock_timestamp();
begin
  if p_user_id is null
    or p_day_id is null
    or p_session_key is null
    or length(p_session_key) not between 16 and 128
    or p_provider is null
    or length(p_provider) not between 1 and 40
    or p_voice_persona is null
    or p_voice_persona not in ('tyler', 'devin', 'maya', 'ava')
    or coalesce(p_state_version, 0) not between 0 and 1000000
  then
    raise exception 'Invalid coach agent session bootstrap';
  end if;

  if not exists (
    select 1 from public.workout_days day
    where day.id = p_day_id and day.user_id = p_user_id
  ) then
    return query select null::uuid, null::timestamptz, null::timestamptz,
      null::timestamptz, 0, 0::numeric, daily_budget, daily_budget, false,
      'workout_day_not_found'::text;
    return;
  end if;

  select session.* into existing_session
  from public.coach_sessions session
  where session.session_key = p_session_key
  for update;

  if found and (
    existing_session.user_id <> p_user_id
    or existing_session.day_id <> p_day_id
  ) then
    return query select existing_session.id, existing_session.started_at,
      existing_session.refreshed_at, existing_session.expires_at,
      existing_session.state_version, 0::numeric, daily_budget, 0::numeric,
      false, 'session_key_conflict'::text;
    return;
  end if;

  select profile.timezone into local_timezone
  from public.profiles profile
  where profile.id = p_user_id
    and exists (
      select 1 from pg_timezone_names timezone
      where timezone.name = profile.timezone
    );
  local_timezone := coalesce(local_timezone, 'UTC');
  local_date := (current_time at time zone local_timezone)::date;

  insert into public.coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict on constraint coach_daily_usage_pkey do nothing;

  select usage.spent_usd into current_spent
  from public.coach_daily_usage usage
  where usage.user_id = p_user_id and usage.usage_date = local_date
  for update;

  if current_spent >= daily_budget then
    return query select
      case when existing_session.id is null then null else existing_session.id end,
      existing_session.started_at, existing_session.refreshed_at,
      existing_session.expires_at, coalesce(existing_session.state_version, 0),
      current_spent, daily_budget, 0::numeric, false,
      'daily_budget_exhausted'::text;
    return;
  end if;

  if existing_session.id is null then
    insert into public.coach_sessions (
      user_id, day_id, session_key, model, provider, voice_persona,
      state_version, started_at, refreshed_at, expires_at, ended_at
    ) values (
      p_user_id, p_day_id, p_session_key, p_model, p_provider, p_voice_persona,
      coalesce(p_state_version, 0), current_time, current_time,
      current_time + interval '24 hours', null
    )
    returning * into active_session;
  else
    update public.coach_sessions session
    set model = p_model,
        provider = p_provider,
        voice_persona = p_voice_persona,
        state_version = greatest(session.state_version, coalesce(p_state_version, 0)),
        started_at = case
          when session.ended_at is not null or session.expires_at <= current_time
            then current_time
          else session.started_at
        end,
        refreshed_at = current_time,
        expires_at = current_time + interval '24 hours',
        ended_at = null
    where session.id = existing_session.id
    returning * into active_session;
  end if;

  insert into public.coach_session_events (
    session_id, user_id, day_id, provider, event_type, details
  ) values (
    active_session.id, p_user_id, p_day_id, p_provider,
    case when existing_session.id is null then 'bootstrap_created' else 'bootstrap_refreshed' end,
    jsonb_build_object(
      'state_version', active_session.state_version,
      'voice_persona', p_voice_persona
    )
  );

  return query select active_session.id, active_session.started_at,
    active_session.refreshed_at, active_session.expires_at,
    active_session.state_version, current_spent, daily_budget,
    greatest(0, daily_budget - current_spent), true, null::text;
end;
$$;

revoke all on function public.bootstrap_coach_agent_session(
  uuid, uuid, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.bootstrap_coach_agent_session(
  uuid, uuid, text, text, text, text, integer
) to service_role;
