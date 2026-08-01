-- Account for deterministic coach TTS in the existing daily coach budget.
-- TTS requests use a separate ledger because coach_usage_logs is a cumulative,
-- one-row-per-Realtime-session table.

create table if not exists public.coach_tts_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.coach_sessions(id) on delete cascade,
  session_key text not null,
  request_id text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  text_length integer not null check (text_length between 1 and 300),
  model text not null,
  voice text not null,
  estimated_cost_usd numeric(12, 8) not null check (estimated_cost_usd >= 0),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists idx_coach_tts_requests_user_created
  on public.coach_tts_requests (user_id, created_at desc);
create index if not exists idx_coach_tts_requests_session
  on public.coach_tts_requests (session_id, created_at desc);

alter table public.coach_tts_requests enable row level security;

drop policy if exists coach_tts_requests_select_own on public.coach_tts_requests;
create policy coach_tts_requests_select_own on public.coach_tts_requests
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reserve_coach_tts_usage(
  p_user_id uuid,
  p_session_key text,
  p_request_id text,
  p_text_sha256 text,
  p_text_length integer,
  p_model text,
  p_voice text,
  p_estimated_cost_usd numeric,
  p_max_requests_per_minute integer default 30,
  p_max_requests_per_session integer default 200
)
returns table (
  allowed boolean,
  duplicate boolean,
  reason text,
  request_status text,
  spent_usd numeric,
  budget_usd numeric,
  remaining_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_session public.coach_sessions%rowtype;
  existing_request public.coach_tts_requests%rowtype;
  local_timezone text := 'UTC';
  local_date date;
  current_spent numeric := 0;
  request_cost numeric := greatest(0, coalesce(p_estimated_cost_usd, 0));
begin
  if p_user_id is null
    or p_session_key is null or length(p_session_key) not between 16 and 128
    or p_request_id is null or length(p_request_id) not between 8 and 128
    or p_text_sha256 !~ '^[0-9a-f]{64}$'
    or p_text_length not between 1 and 300
    or request_cost > 0.02
  then
    raise exception 'Invalid TTS reservation';
  end if;

  select session.* into active_session
  from public.coach_sessions session
  where session.user_id = p_user_id
    and session.session_key = p_session_key
    and session.ended_at is null
    and session.expires_at > clock_timestamp();
  if not found then
    return query select false, false, 'inactive_session'::text, null::text,
      0::numeric, 0.75::numeric, 0::numeric;
    return;
  end if;

  -- Serialize equal request IDs so concurrent retries cannot call OpenAI twice.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_request_id, 0)
  );
  select request.* into existing_request
  from public.coach_tts_requests request
  where request.user_id = p_user_id and request.request_id = p_request_id;
  if found then
    return query select false, true,
      case
        when existing_request.text_sha256 <> p_text_sha256 then 'request_id_conflict'
        else 'duplicate_request'
      end,
      existing_request.status,
      0::numeric, 0.75::numeric, 0::numeric;
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
  local_date := (clock_timestamp() at time zone local_timezone)::date;

  insert into public.coach_daily_usage (user_id, usage_date, timezone, spent_usd)
  values (p_user_id, local_date, local_timezone, 0)
  on conflict on constraint coach_daily_usage_pkey do nothing;

  select usage.spent_usd into current_spent
  from public.coach_daily_usage usage
  where usage.user_id = p_user_id and usage.usage_date = local_date
  for update;

  if (
    select count(*) from public.coach_tts_requests request
    where request.user_id = p_user_id
      and request.status in ('processing', 'completed')
      and request.created_at >= clock_timestamp() - interval '1 minute'
  ) >= greatest(1, least(p_max_requests_per_minute, 60)) then
    return query select false, false, 'rate_limit'::text, null::text,
      current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent);
    return;
  end if;

  if (
    select count(*) from public.coach_tts_requests request
    where request.session_id = active_session.id
      and request.status in ('processing', 'completed')
  ) >= greatest(1, least(p_max_requests_per_session, 500)) then
    return query select false, false, 'session_limit'::text, null::text,
      current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent);
    return;
  end if;

  if current_spent + request_cost > 0.75 then
    return query select false, false, 'daily_budget_exhausted'::text, null::text,
      current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent);
    return;
  end if;

  update public.coach_daily_usage usage
  set spent_usd = usage.spent_usd + request_cost, updated_at = now()
  where usage.user_id = p_user_id and usage.usage_date = local_date
  returning usage.spent_usd into current_spent;

  insert into public.coach_tts_requests (
    user_id, session_id, session_key, request_id, text_sha256, text_length,
    model, voice, estimated_cost_usd
  ) values (
    p_user_id, active_session.id, p_session_key, p_request_id, p_text_sha256,
    p_text_length, p_model, p_voice, request_cost
  );

  return query select true, false, null::text, 'processing'::text,
    current_spent, 0.75::numeric, greatest(0, 0.75 - current_spent);
end;
$$;

create or replace function public.finalize_coach_tts_usage(
  p_user_id uuid,
  p_request_id text,
  p_succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.coach_tts_requests%rowtype;
  local_timezone text := 'UTC';
  local_date date;
begin
  select request.* into request_row
  from public.coach_tts_requests request
  where request.user_id = p_user_id and request.request_id = p_request_id
  for update;

  if not found or request_row.status <> 'processing' then return; end if;

  if coalesce(p_succeeded, false) then
    update public.coach_tts_requests
    set status = 'completed', updated_at = now()
    where id = request_row.id;
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
  local_date := (request_row.created_at at time zone local_timezone)::date;

  update public.coach_daily_usage usage
  set spent_usd = greatest(0, usage.spent_usd - request_row.estimated_cost_usd),
      updated_at = now()
  where usage.user_id = p_user_id and usage.usage_date = local_date;

  update public.coach_tts_requests
  set status = 'failed', updated_at = now()
  where id = request_row.id;
end;
$$;

revoke all on function public.reserve_coach_tts_usage(
  uuid, text, text, text, integer, text, text, numeric, integer, integer
) from public, anon, authenticated;
revoke all on function public.finalize_coach_tts_usage(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.reserve_coach_tts_usage(
  uuid, text, text, text, integer, text, text, numeric, integer, integer
) to service_role;
grant execute on function public.finalize_coach_tts_usage(uuid, text, boolean)
  to service_role;
