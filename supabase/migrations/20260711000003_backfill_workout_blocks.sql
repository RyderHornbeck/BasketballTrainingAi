-- Group workout days created before rolling blocks into five-day UI blocks.
-- Newly generated days already receive an explicit block_index.

update workout_days
set block_index = floor((greatest(day_number, 1) - 1) / 5.0)::int + 1
where day_number is not null;
