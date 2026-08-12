-- Provider credentials are minted only after the bootstrap budget check, but
-- direct mobile STT/TTS transports report their metered usage asynchronously.
-- Once the authoritative ledger is exhausted, close every active server
-- session so no additional Haiku turns or refreshed provider credentials can
-- be issued for that user today.
create or replace function public.close_coach_sessions_at_daily_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.spent_usd >= 0.85 then
    update public.coach_sessions
    set ended_at = coalesce(ended_at, clock_timestamp())
    where user_id = new.user_id
      and ended_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists coach_daily_usage_budget_enforcement
  on public.coach_daily_usage;
create trigger coach_daily_usage_budget_enforcement
after insert or update of spent_usd on public.coach_daily_usage
for each row
when (new.spent_usd >= 0.85)
execute function public.close_coach_sessions_at_daily_budget();

-- Apply the server-side stop immediately for accounts already at the limit.
update public.coach_sessions session
set ended_at = coalesce(session.ended_at, clock_timestamp())
where session.ended_at is null
  and exists (
    select 1
    from public.coach_daily_usage usage
    where usage.user_id = session.user_id
      and usage.usage_date = (clock_timestamp() at time zone coalesce(
        (select profile.timezone
         from public.profiles profile
         where profile.id = session.user_id
           and exists (
             select 1 from pg_timezone_names timezone
             where timezone.name = profile.timezone
           )
         limit 1),
        'UTC'
      ))::date
      and usage.spent_usd >= 0.85
  );
