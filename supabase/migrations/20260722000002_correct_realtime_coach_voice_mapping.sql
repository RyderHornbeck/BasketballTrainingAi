-- Coach Tyler now uses the masculine Ash voice, while Coach Maya uses Marin.
-- Preserve the selected coach for existing accounts as these mappings change.
alter table public.profiles
  drop constraint if exists profiles_realtime_coach_voice_allowed;

update public.profiles
set realtime_coach_voice = case realtime_coach_voice
  when 'marin' then 'ash'
  when 'coral' then 'marin'
  else realtime_coach_voice
end;

alter table public.profiles
  alter column realtime_coach_voice set default 'ash',
  add constraint profiles_realtime_coach_voice_allowed
    check (realtime_coach_voice in ('ash', 'cedar', 'marin', 'shimmer'));

notify pgrst, 'reload schema';
