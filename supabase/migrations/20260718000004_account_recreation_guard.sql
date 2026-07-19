-- Prevent deleting and recreating the same login identity to reset per-user
-- quotas. Only an irreversible SHA-256 digest of the normalized email is kept.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_identity_guard (
  identity_hash text primary key check (length(identity_hash) = 64),
  deletion_count integer not null default 1 check (deletion_count > 0),
  window_started_at timestamptz not null default now(),
  last_deleted_at timestamptz not null default now(),
  recreate_after timestamptz not null,
  updated_at timestamptz not null default now()
);

revoke all on private.account_identity_guard from public, anon, authenticated;

create or replace function public.record_account_deletion_guard(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  hashed_identity text;
  next_count integer;
  blocked_until timestamptz;
begin
  select lower(btrim(email))
  into normalized_email
  from auth.users
  where id = p_user_id;

  if normalized_email is null or normalized_email = '' then
    raise exception 'A verified email identity is required for account deletion'
      using errcode = '22023';
  end if;

  hashed_identity := encode(extensions.digest(normalized_email, 'sha256'), 'hex');

  insert into private.account_identity_guard (
    identity_hash,
    deletion_count,
    window_started_at,
    last_deleted_at,
    recreate_after,
    updated_at
  )
  values (
    hashed_identity,
    1,
    now(),
    now(),
    now() + interval '24 hours',
    now()
  )
  on conflict (identity_hash) do update
  set
    deletion_count = case
      when private.account_identity_guard.window_started_at < now() - interval '30 days'
        then 1
      else private.account_identity_guard.deletion_count + 1
    end,
    window_started_at = case
      when private.account_identity_guard.window_started_at < now() - interval '30 days'
        then now()
      else private.account_identity_guard.window_started_at
    end,
    last_deleted_at = now(),
    recreate_after = case
      when (
        case
          when private.account_identity_guard.window_started_at < now() - interval '30 days'
            then 1
          else private.account_identity_guard.deletion_count + 1
        end
      ) >= 3
        then now() + interval '30 days'
      else now() + interval '24 hours'
    end,
    updated_at = now()
  returning deletion_count, recreate_after
  into next_count, blocked_until;

  return blocked_until;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  hashed_identity text;
  blocked_until timestamptz;
begin
  normalized_email := lower(btrim(new.email));
  if normalized_email is not null and normalized_email <> '' then
    hashed_identity := encode(extensions.digest(normalized_email, 'sha256'), 'hex');
    select guard.recreate_after
    into blocked_until
    from private.account_identity_guard guard
    where guard.identity_hash = hashed_identity;

    if blocked_until is not null and blocked_until > now() then
      raise exception 'Account recreation is temporarily unavailable'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    )
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, profiles.email),
    full_name = coalesce(profiles.full_name, excluded.full_name);

  return new;
end;
$$;

revoke execute on function public.record_account_deletion_guard(uuid)
  from public, anon, authenticated;
grant execute on function public.record_account_deletion_guard(uuid)
  to service_role;
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
