-- Restore the durable deleted-identity cooldown after the temporary testing
-- override. The keyed HMAC ledger and triggers were intentionally preserved.

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

notify pgrst, 'reload schema';
