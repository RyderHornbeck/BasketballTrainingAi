-- Temporary testing override: allow a deleted login identity to create a new
-- account immediately. Keep the private ledger intact so enforcement can be
-- restored in a later migration.

create or replace function private.record_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
begin
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
