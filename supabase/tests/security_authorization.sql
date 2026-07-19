begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  (
    '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'owner-security-test@example.com', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
    'other-security-test@example.com', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

insert into public.onboarding_answers (
  user_id, days_per_week, minutes_per_workout
) values
  ('10000000-0000-0000-0000-000000000001', 3, 45),
  ('20000000-0000-0000-0000-000000000002', 3, 45);

insert into public.workout_plans (id, user_id, title, active) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Owner plan', true),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Other plan', true);
insert into public.workout_days (
  id, plan_id, user_id, day_number, locked, completed
) values
  (
    '11100000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    1, false, false
  ),
  (
    '22200000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    1, false, false
  ),
  (
    '11100000-0000-0000-0000-000000000003',
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    2, false, false
  );
insert into public.workout_exercises (
  id, day_id, user_id, order_index, name, category, sets, log_type
) values
  (
    '11110000-0000-0000-0000-000000000001',
    '11100000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    1, 'Owner drill', 'shooting', '1', 'makes_attempts'
  ),
  (
    '22220000-0000-0000-0000-000000000002',
    '22200000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    1, 'Other drill', 'shooting', '1', 'makes_attempts'
  );

set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501',
  null,
  'anonymous users cannot read profiles'
);
select throws_ok(
  $$insert into public.onboarding_answers (user_id) values ('10000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'anonymous users cannot insert application data'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select is((select count(*) from public.profiles), 1::bigint, 'owner reads only their profile');
select is((select count(*) from public.workout_plans), 1::bigint, 'owner reads only their plans');
select throws_ok(
  $$update public.workout_days set completed = true where id = '11100000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'server-controlled workout state cannot be updated directly'
);
select throws_ok(
  $$insert into public.plan_generation_requests (user_id, status) values ('10000000-0000-0000-0000-000000000001', 'completed')$$,
  '42501',
  null,
  'generation status cannot be supplied directly'
);
select lives_ok(
  $$select public.create_my_plan_generation_request('initial', null, 1)$$,
  'owner can request generation through the guarded RPC'
);
select lives_ok(
  $$insert into public.exercise_logs (exercise_id, day_id, user_id, completed, makes, attempts)
    values (
      '11110000-0000-0000-0000-000000000001',
      '11100000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      true, 5, 10
    )$$,
  'owner can save a log for their own exercise'
);
select throws_ok(
  $$insert into public.exercise_logs (exercise_id, day_id, user_id, completed)
    values (
      '22220000-0000-0000-0000-000000000002',
      '22200000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      true
    )$$,
  '42501',
  null,
  'owner cannot attach logs to another user workout'
);
select lives_ok(
  $$update public.profiles set theme = 'dark' where id = '10000000-0000-0000-0000-000000000001'$$,
  'owner can update an explicitly user-controlled profile field'
);
select throws_ok(
  $$update public.profiles set onboarding_completed = true where id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'owner cannot directly update protected profile state'
);
select throws_ok(
  $$select public.sync_my_overall_skill_rating(100)$$,
  '42501',
  null,
  'client cannot submit a trusted achievement rating'
);
select lives_ok(
  $$select public.finish_my_workout_day('11100000-0000-0000-0000-000000000001')$$,
  'owner can finish an unlocked workout through the guarded RPC'
);
select lives_ok(
  $$update public.exercise_logs
    set makes = 6, attempts = 10
    where exercise_id = '11110000-0000-0000-0000-000000000001'$$,
  'owner can correct a log after automatic workout completion'
);
select is(
  (select count(*) from public.workout_day_logs),
  1::bigint,
  'owner can read completed workout history for analytics'
);
select lives_ok(
  $$update public.profiles
    set push_token = 'security-test-device-token'
    where id = '10000000-0000-0000-0000-000000000001'$$,
  'owner can register a notification token'
);
select lives_ok(
  $$select public.finish_my_workout_day('11100000-0000-0000-0000-000000000003')$$,
  'owner can finish an empty unlocked workout'
);
select is(
  (
    select completion_kind
    from public.workout_days
    where id = '11100000-0000-0000-0000-000000000003'
  ),
  'partial',
  'empty workouts are not classified as fully completed'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}',
  true
);
set local role authenticated;
select is(
  (
    select count(*)
    from public.workout_plans
    where id = '11000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'a forged admin claim does not bypass ownership'
);
select throws_ok(
  $$select public.finish_my_workout_day('11100000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'another user cannot finish the owner workout'
);

reset role;
set local role service_role;
select lives_ok(
  $$insert into public.workout_plans (user_id, title)
    values ('10000000-0000-0000-0000-000000000001', 'Service plan')$$,
  'service role can perform server-owned writes'
);

reset role;
insert into public.coach_daily_usage (user_id, usage_date, spent_usd)
values ('10000000-0000-0000-0000-000000000001', current_date, 0.25)
on conflict (user_id, usage_date) do update set spent_usd = excluded.spent_usd;
insert into public.workout_editor_daily_usage (user_id, usage_date, request_count)
values ('10000000-0000-0000-0000-000000000001', current_date, 3)
on conflict (user_id, usage_date) do update set request_count = excluded.request_count;

set local role service_role;
select lives_ok(
  $$select public.reset_training_account('10000000-0000-0000-0000-000000000001')$$,
  'service role can reset training content'
);

reset role;
select is(
  (
    select count(*)
    from public.coach_daily_usage
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'training reset preserves the coach daily quota ledger'
);
select is(
  (
    select count(*)
    from public.workout_editor_daily_usage
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'training reset preserves the workout editor daily quota ledger'
);

reset role;
set local role authenticated;
select throws_ok(
  $$select public.record_account_deletion_guard('10000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'authenticated clients cannot write the account identity guard'
);

reset role;
select lives_ok(
  $$delete from auth.users
    where id = '10000000-0000-0000-0000-000000000001'$$,
  'hard deletion atomically records the account identity cooldown'
);

select ok(
  (
    select recreate_after > now()
    from private.account_identity_guard
    where identity_hash = private.account_identity_hash(
      'owner-security-test@example.com'
    )
  ),
  'account deletion creates a future recreation deadline'
);
select throws_ok(
  $$insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data
    ) values (
      '30000000-0000-0000-0000-000000000003',
      'authenticated',
      'authenticated',
      'OWNER-SECURITY-TEST@example.com',
      '',
      now(),
      now(),
      now(),
      '{}'::jsonb,
      '{}'::jsonb
    )$$,
  'P0001',
  'Account recreation is temporarily unavailable',
  'the auth trigger blocks recreation of the normalized identity'
);

reset role;
select * from finish();
rollback;
