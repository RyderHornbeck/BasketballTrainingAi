-- A Realtime client can invoke disconnect cleanup concurrently. Keep the
-- highest/final per-session report and make future writes idempotent.
with ranked_usage_logs as (
  select
    id,
    row_number() over (
      partition by session_key
      order by
        response_count desc,
        estimated_cost_usd desc,
        session_duration_ms desc,
        created_at desc,
        id desc
    ) as row_number
  from coach_usage_logs
)
delete from coach_usage_logs
where id in (
  select id
  from ranked_usage_logs
  where row_number > 1
);

alter table coach_usage_logs
  add constraint coach_usage_logs_session_key_unique unique (session_key);
