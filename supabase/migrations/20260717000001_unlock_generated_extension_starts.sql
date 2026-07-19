-- Extension blocks are generated after the preceding block is complete.
-- Repair existing first days that were inserted locked by the old generator.
with first_days_in_block as (
  select distinct on (plan_id, block_index)
    id,
    plan_id,
    day_number
  from public.workout_days
  order by plan_id, block_index, day_number
)
update public.workout_days extension_day
set locked = false,
    scheduled_date = null
from first_days_in_block first_day
join public.workout_days previous_day
  on previous_day.plan_id = first_day.plan_id
 and previous_day.day_number = first_day.day_number - 1
where extension_day.id = first_day.id
  and previous_day.completed = true
  and extension_day.completed = false;
