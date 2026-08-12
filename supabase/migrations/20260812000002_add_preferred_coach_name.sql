alter table public.profiles
  add column if not exists preferred_name text;

alter table public.profiles
  drop constraint if exists profiles_preferred_name_valid;

alter table public.profiles
  add constraint profiles_preferred_name_valid
  check (
    preferred_name is null
    or (
      preferred_name = btrim(preferred_name)
      and char_length(preferred_name) between 1 and 80
      and preferred_name ~ '^[[:alpha:]][[:alpha:] ''-]*$'
    )
  );

grant update (preferred_name) on public.profiles to authenticated;

notify pgrst, 'reload schema';
