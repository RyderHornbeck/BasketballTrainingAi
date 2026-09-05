-- Existing workouts keep a copy of catalog instructions. Align those copies
-- with the corrected Form Shooting catalog description.
update public.workout_exercises
set instructions = replace(
  instructions,
  ' (near your hip and chest)',
  ''
)
where name = 'Form Shooting'
  and instructions ilike '%near your hip and chest%';
