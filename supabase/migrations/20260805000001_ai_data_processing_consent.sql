-- Server-authoritative consent entitlement for third-party AI processing.
alter table public.profiles
  add column if not exists ai_data_processing_allowed boolean not null default false,
  add column if not exists ai_data_processing_consent_version text,
  add column if not exists ai_data_processing_consent_updated_at timestamptz;

create table if not exists public.ai_data_processing_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  allowed boolean not null,
  consent_version text not null,
  source text not null check (source in ('onboarding', 'settings', 'coach_gate')),
  created_at timestamptz not null default now()
);

create index if not exists ai_data_processing_consent_events_user_created_idx
  on public.ai_data_processing_consent_events (user_id, created_at desc);

alter table public.ai_data_processing_consent_events enable row level security;

drop policy if exists ai_data_processing_consent_events_select_own
  on public.ai_data_processing_consent_events;
create policy ai_data_processing_consent_events_select_own
  on public.ai_data_processing_consent_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.ai_data_processing_consent_events from anon, authenticated;
grant select on public.ai_data_processing_consent_events to authenticated;

create or replace function public.set_ai_data_processing_consent(
  p_allowed boolean,
  p_consent_version text,
  p_source text default 'settings'
)
returns table (
  allowed boolean,
  consent_version text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_version text := nullif(btrim(p_consent_version), '');
  v_source text := lower(nullif(btrim(p_source), ''));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if v_version is null or length(v_version) > 80 then
    raise exception 'Invalid consent version';
  end if;
  if v_source not in ('onboarding', 'settings', 'coach_gate') then
    raise exception 'Invalid consent source';
  end if;

  update public.profiles
  set
    ai_data_processing_allowed = coalesce(p_allowed, false),
    ai_data_processing_consent_version = v_version,
    ai_data_processing_consent_updated_at = v_now
  where id = v_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;

  insert into public.ai_data_processing_consent_events (
    user_id,
    allowed,
    consent_version,
    source,
    created_at
  )
  values (
    v_user_id,
    coalesce(p_allowed, false),
    v_version,
    v_source,
    v_now
  );

  return query
  select
    coalesce(p_allowed, false),
    v_version,
    v_now;
end;
$$;

revoke all on function public.set_ai_data_processing_consent(boolean, text, text)
  from public, anon;
grant execute on function public.set_ai_data_processing_consent(boolean, text, text)
  to authenticated;

notify pgrst, 'reload schema';
