-- Make account-deletion tracking atomic and resistant to offline email
-- enumeration. Deletion is recorded by PostgreSQL in the same transaction as
-- the auth.users delete, using an HMAC key held in Supabase Vault.

alter table private.account_identity_guard
  rename to account_identity_guard_legacy;

create table private.account_identity_guard (
  identity_hash text primary key check (length(identity_hash) = 64),
  deletion_count integer not null default 1 check (deletion_count > 0),
  window_started_at timestamptz not null default clock_timestamp(),
  last_deleted_at timestamptz not null default clock_timestamp(),
  recreate_after timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);

create table private.account_identity_hashes (
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_hash text not null check (length(identity_hash) = 64),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (user_id, identity_hash)
);

revoke all on private.account_identity_guard
  from public, anon, authenticated, service_role;
revoke all on private.account_identity_guard_legacy
  from public, anon, authenticated, service_role;
revoke all on private.account_identity_hashes
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'account_identity_guard_hmac_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'account_identity_guard_hmac_v1',
      'HMAC key for the deleted-account identity cooldown'
    );
  end if;
end;
$$;

create or replace function private.account_identity_hash(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  hmac_key_hex text;
begin
  normalized_email := lower(btrim(p_email));
  if normalized_email is null or normalized_email = '' then
    raise exception 'A trusted email identity is required' using errcode = '22023';
  end if;

  select decrypted_secret
  into hmac_key_hex
  from vault.decrypted_secrets
  where name = 'account_identity_guard_hmac_v1';

  if hmac_key_hex is null then
    raise exception 'Account identity guard key is unavailable';
  end if;

  return encode(
    extensions.hmac(
      convert_to(normalized_email, 'UTF8'),
      decode(hmac_key_hex, 'hex'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

revoke execute on function private.account_identity_hash(text)
  from public, anon, authenticated, service_role;

create or replace function private.capture_auth_user_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and btrim(new.email) <> '' then
    insert into private.account_identity_hashes (user_id, identity_hash)
    values (new.id, private.account_identity_hash(new.email))
    on conflict (user_id, identity_hash) do update
      set last_seen_at = clock_timestamp();
  end if;
  return new;
end;
$$;

revoke execute on function private.capture_auth_user_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists capture_auth_user_identity on auth.users;
create trigger capture_auth_user_identity
  after insert or update of email on auth.users
  for each row execute function private.capture_auth_user_identity();

insert into private.account_identity_hashes (user_id, identity_hash)
select id, private.account_identity_hash(email)
from auth.users
where email is not null and btrim(email) <> ''
on conflict (user_id, identity_hash) do nothing;

create or replace function private.record_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hashed_identity text;
  recorded_identity boolean := false;
begin
  for hashed_identity in
    select identity_hash
    from private.account_identity_hashes
    where user_id = old.id
    union
    select private.account_identity_hash(old.email)
    where old.email is not null and btrim(old.email) <> ''
  loop
    recorded_identity := true;

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
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp() + interval '24 hours',
      clock_timestamp()
    )
    on conflict (identity_hash) do update
    set
      deletion_count = case
        when private.account_identity_guard.window_started_at
          < clock_timestamp() - interval '30 days'
          then 1
        else private.account_identity_guard.deletion_count + 1
      end,
      window_started_at = case
        when private.account_identity_guard.window_started_at
          < clock_timestamp() - interval '30 days'
          then clock_timestamp()
        else private.account_identity_guard.window_started_at
      end,
      last_deleted_at = clock_timestamp(),
      recreate_after = greatest(
        private.account_identity_guard.recreate_after,
        case
          when (
            case
              when private.account_identity_guard.window_started_at
                < clock_timestamp() - interval '30 days'
                then 1
              else private.account_identity_guard.deletion_count + 1
            end
          ) >= 3
            then clock_timestamp() + interval '30 days'
          else clock_timestamp() + interval '24 hours'
        end
      ),
      updated_at = clock_timestamp();
  end loop;

  if not recorded_identity then
    raise exception 'Account deletion could not be safely recorded';
  end if;

  return old;
end;
$$;

revoke execute on function private.record_auth_user_deletion()
  from public, anon, authenticated, service_role;

drop trigger if exists record_auth_user_deletion on auth.users;
create trigger record_auth_user_deletion
  before delete on auth.users
  for each row execute function private.record_auth_user_deletion();

-- Keep the version-1 Edge Function safe during the brief deployment overlap.
-- The database deletion trigger is now the sole source of ledger writes.
create or replace function public.record_account_deletion_guard(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select clock_timestamp()
$$;

revoke execute on function public.record_account_deletion_guard(uuid)
  from public, anon, authenticated;
grant execute on function public.record_account_deletion_guard(uuid)
  to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keyed_identity text;
  legacy_identity text;
  blocked_until timestamptz;
begin
  if new.email is not null and btrim(new.email) <> '' then
    keyed_identity := private.account_identity_hash(new.email);
    legacy_identity := encode(
      extensions.digest(lower(btrim(new.email)), 'sha256'),
      'hex'
    );

    select max(recreate_after)
    into blocked_until
    from (
      select recreate_after
      from private.account_identity_guard
      where identity_hash = keyed_identity
      union all
      select recreate_after
      from private.account_identity_guard_legacy
      where identity_hash = legacy_identity
    ) cooldowns;

    if blocked_until is not null and blocked_until > clock_timestamp() then
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

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

-- Reset training content without resetting daily cost and request quotas.
create or replace function public.reset_training_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.coach_sessions where user_id = p_user_id;
  delete from public.coach_tool_requests where user_id = p_user_id;
  delete from public.coach_usage_logs where user_id = p_user_id;
  delete from public.workout_edit_messages where user_id = p_user_id;
  delete from public.workout_edit_revisions where user_id = p_user_id;
  delete from public.plan_generation_requests where user_id = p_user_id;
  delete from public.workout_plans where user_id = p_user_id;
  delete from public.user_achievements where user_id = p_user_id;
  delete from public.user_skill_rating_snapshots where user_id = p_user_id;
  delete from public.onboarding_answers where user_id = p_user_id;

  update public.profiles
  set onboarding_completed = false, push_token = null
  where id = p_user_id;
end;
$$;

revoke all on function public.reset_training_account(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_training_account(uuid)
  to service_role;

notify pgrst, 'reload schema';
