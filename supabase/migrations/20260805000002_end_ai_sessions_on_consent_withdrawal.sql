-- Revoking consent prevents active coach sessions from making later model/tool
-- requests. Direct provider tokens remain short-lived and cannot be revoked by
-- the database after issuance.
create or replace function public.end_coach_sessions_on_ai_consent_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ai_data_processing_allowed = true
     and new.ai_data_processing_allowed = false then
    update public.coach_sessions
    set ended_at = coalesce(ended_at, clock_timestamp())
    where user_id = new.id
      and ended_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.end_coach_sessions_on_ai_consent_withdrawal()
  from public, anon, authenticated;

drop trigger if exists profiles_end_coach_sessions_on_ai_consent_withdrawal
  on public.profiles;
create trigger profiles_end_coach_sessions_on_ai_consent_withdrawal
after update of ai_data_processing_allowed on public.profiles
for each row
execute function public.end_coach_sessions_on_ai_consent_withdrawal();
