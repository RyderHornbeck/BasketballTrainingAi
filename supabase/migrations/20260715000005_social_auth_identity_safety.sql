-- Social auth identity data and one onboarding record per Supabase user.
alter table public.profiles
  add column if not exists full_name text;

-- profiles.id is already the auth.users(id) primary key, so it is the unique
-- user identifier and a second user_id column would weaken the schema.

delete from public.onboarding_answers
where user_id is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc nulls last, id desc
    ) as row_number
  from public.onboarding_answers
)
delete from public.onboarding_answers as answers
using ranked
where answers.id = ranked.id
  and ranked.row_number > 1;

alter table public.onboarding_answers
  alter column user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.onboarding_answers'::regclass
      and conname = 'onboarding_answers_user_id_key'
  ) then
    alter table public.onboarding_answers
      add constraint onboarding_answers_user_id_key unique (user_id);
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
