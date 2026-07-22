-- Persist the athlete's selected OpenAI Realtime voice. The client only offers
-- the four named coaches, and this constraint keeps stored values aligned.
alter table public.profiles
  add column if not exists realtime_coach_voice text not null default 'marin',
  add constraint profiles_realtime_coach_voice_allowed
    check (realtime_coach_voice in ('marin', 'cedar', 'coral', 'shimmer')) not valid;

alter table public.profiles
  validate constraint profiles_realtime_coach_voice_allowed;

grant update (realtime_coach_voice) on public.profiles to authenticated;

notify pgrst, 'reload schema';
