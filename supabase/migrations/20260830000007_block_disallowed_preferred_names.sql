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
      and preferred_name !~* '(^|[^[:alpha:]])(nigga|nigger|faggot|kike|spic|chink)([^[:alpha:]]|$)'
    )
  );
