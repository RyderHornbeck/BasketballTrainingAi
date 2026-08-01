alter table public.coach_tts_requests
  add column if not exists estimated_text_tokens integer
    generated always as ((text_length + 3) / 4) stored,
  add column if not exists latency_ms integer
    check (latency_ms is null or latency_ms >= 0),
  add column if not exists error_code text;

