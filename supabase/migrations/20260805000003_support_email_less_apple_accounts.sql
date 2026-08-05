-- Apple may omit email for a valid returning authorization. Preserve the
-- deleted-account recreation guard by tracking the stable provider subject,
-- not only an email address.

create or replace function private.account_provider_identity_hash(
  p_provider text,
  p_provider_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_identity text;
  hmac_key_hex text;
begin
  normalized_identity := lower(btrim(p_provider)) || ':' || btrim(p_provider_id);
  if p_provider is null
    or btrim(p_provider) = ''
    or p_provider_id is null
    or btrim(p_provider_id) = '' then
    raise exception 'A trusted provider identity is required' using errcode = '22023';
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
      convert_to('provider:' || normalized_identity, 'UTF8'),
      decode(hmac_key_hex, 'hex'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

revoke execute on function private.account_provider_identity_hash(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.enforce_auth_provider_identity_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blocked_until timestamptz;
begin
  select recreate_after
  into blocked_until
  from private.account_identity_guard
  where identity_hash = private.account_provider_identity_hash(
    new.provider,
    new.provider_id
  );

  if blocked_until is not null and blocked_until > clock_timestamp() then
    raise exception 'Account recreation is temporarily unavailable'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_auth_provider_identity_cooldown()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_auth_provider_identity_cooldown on auth.identities;
create trigger enforce_auth_provider_identity_cooldown
  before insert or update of provider, provider_id on auth.identities
  for each row execute function private.enforce_auth_provider_identity_cooldown();

create or replace function private.capture_auth_provider_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.account_identity_hashes (user_id, identity_hash)
  values (
    new.user_id,
    private.account_provider_identity_hash(new.provider, new.provider_id)
  )
  on conflict (user_id, identity_hash) do update
    set last_seen_at = clock_timestamp();
  return new;
end;
$$;

revoke execute on function private.capture_auth_provider_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists capture_auth_provider_identity on auth.identities;
create trigger capture_auth_provider_identity
  after insert or update of provider, provider_id on auth.identities
  for each row execute function private.capture_auth_provider_identity();

insert into private.account_identity_hashes (user_id, identity_hash)
select
  identity.user_id,
  private.account_provider_identity_hash(identity.provider, identity.provider_id)
from auth.identities identity
where identity.provider is not null
  and btrim(identity.provider) <> ''
  and identity.provider_id is not null
  and btrim(identity.provider_id) <> ''
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
    union
    select private.account_provider_identity_hash(identity.provider, identity.provider_id)
    from auth.identities identity
    where identity.user_id = old.id
      and identity.provider is not null
      and btrim(identity.provider) <> ''
      and identity.provider_id is not null
      and btrim(identity.provider_id) <> ''
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
