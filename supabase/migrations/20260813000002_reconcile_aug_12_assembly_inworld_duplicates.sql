-- A pre-deployment audit identified these seven Assembly/Inworld TTS rows as
-- duplicate reports: each has an equal same-session metric within one second,
-- but a distinct client-generated report ID. Target immutable row IDs and
-- validate their full signatures before removing the duplicate ledger entries.
do $$
declare
  matched_rows integer;
  reconciled_days integer;
begin
  with expected (
    id, user_id, provider_request_id, quantity, estimated_cost_usd
  ) as (
    values
      ('98bdad86-0703-465e-892a-8e03226885d3'::uuid, '92fc91cb-7855-4f2e-b676-d460fbc16ac4'::uuid, 'assembly-inworld-usage-2-1786579586062:tts', 430::numeric, 0.00516000::numeric),
      ('61436446-ba7c-4046-a60f-2e9ea63c2c3b'::uuid, '92fc91cb-7855-4f2e-b676-d460fbc16ac4'::uuid, 'assembly-inworld-usage-3-1786586547672:tts', 201::numeric, 0.00241200::numeric),
      ('8877ec2c-b0d3-486a-b470-0092203c1f42'::uuid, '155f60f5-9d04-47eb-bba5-b4a516cd2c61'::uuid, 'assembly-inworld-usage-5-1786586791865:tts', 417::numeric, 0.00500400::numeric),
      ('f739be7a-9201-4261-8e2b-fb0d8fce8f73'::uuid, '155f60f5-9d04-47eb-bba5-b4a516cd2c61'::uuid, 'assembly-inworld-usage-3-1786588297950:tts', 478::numeric, 0.00573600::numeric),
      ('061375b5-804d-414b-9855-282b24ff8f34'::uuid, '155f60f5-9d04-47eb-bba5-b4a516cd2c61'::uuid, 'assembly-inworld-usage-2-1786588622951:tts', 476::numeric, 0.00571200::numeric),
      ('9353fc94-4393-434e-967c-e01e7e00078d'::uuid, '155f60f5-9d04-47eb-bba5-b4a516cd2c61'::uuid, 'assembly-inworld-usage-4-1786588750139:tts', 386::numeric, 0.00463200::numeric),
      ('251a5fbe-6869-4aaa-a72b-e0cdb91ebc09'::uuid, '155f60f5-9d04-47eb-bba5-b4a516cd2c61'::uuid, 'assembly-inworld-usage-3-1786589461078:tts', 148::numeric, 0.00177600::numeric)
  )
  select count(*) into matched_rows
  from expected expected
  join public.coach_provider_usage usage
    on usage.id = expected.id
   and usage.user_id = expected.user_id
   and usage.provider = 'assembly_inworld'
   and usage.metric = 'inworld_tts2_text'
   and usage.unit = 'characters'
   and usage.provider_request_id = expected.provider_request_id
   and usage.quantity = expected.quantity
   and usage.estimated_cost_usd = expected.estimated_cost_usd
  where exists (
    select 1
    from public.coach_provider_usage peer
    where peer.session_id = usage.session_id
      and peer.id <> usage.id
      and peer.provider = usage.provider
      and peer.metric = usage.metric
      and peer.unit = usage.unit
      and peer.quantity = usage.quantity
      and peer.estimated_cost_usd = usage.estimated_cost_usd
      and abs(extract(epoch from peer.observed_at - usage.observed_at)) < 1
  );

  if matched_rows <> 7 then
    raise exception 'Aug 12 Assembly/Inworld reconciliation signature changed';
  end if;

  with deleted as (
    delete from public.coach_provider_usage
    where id in (
      '98bdad86-0703-465e-892a-8e03226885d3'::uuid,
      '61436446-ba7c-4046-a60f-2e9ea63c2c3b'::uuid,
      '8877ec2c-b0d3-486a-b470-0092203c1f42'::uuid,
      'f739be7a-9201-4261-8e2b-fb0d8fce8f73'::uuid,
      '061375b5-804d-414b-9855-282b24ff8f34'::uuid,
      '9353fc94-4393-434e-967c-e01e7e00078d'::uuid,
      '251a5fbe-6869-4aaa-a72b-e0cdb91ebc09'::uuid
    )
    returning user_id, estimated_cost_usd
  ),
  totals as (
    select user_id, sum(estimated_cost_usd) as duplicate_cost
    from deleted
    group by user_id
  ),
  updated as (
    update public.coach_daily_usage usage
    set spent_usd = greatest(0, usage.spent_usd - totals.duplicate_cost),
        updated_at = clock_timestamp()
    from totals
    where usage.user_id = totals.user_id
      and usage.usage_date = date '2026-08-12'
      and usage.timezone = 'America/New_York'
    returning usage.user_id
  )
  select count(*) into reconciled_days from updated;

  if reconciled_days <> 2 then
    raise exception 'Aug 12 daily usage reconciliation rows changed';
  end if;
end;
$$;
