-- Correct the drill sequence: dribble before the inside shoulder rip.
update public.exercise_video_clips
set description = 'Start on the wing with the ball in an athletic stance. Step 1: Drive toward the basket. Step 2: Take one dribble. Step 3: Rip the ball low below the defender''s hip on the inside. Step 4: Finish with your outside hand on the opposite side.'
where lower(trim(exercise_name)) = 'inside-outside shoulder rip finish';

update public.workout_exercises
set instructions = 'Start on the wing with the ball in an athletic stance. Step 1: Drive toward the basket. Step 2: Take one dribble. Step 3: Rip the ball low below the defender''s hip on the inside. Step 4: Finish with your outside hand on the opposite side.'
where lower(trim(name)) = 'inside-outside shoulder rip finish';

update public.workout_edit_operations
set exercise_snapshot = replace(
  exercise_snapshot::text,
  'Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.',
  'Step 2: Take one dribble. Step 3: Rip the ball low below the defender''s hip on the inside.'
)::jsonb
where exercise_snapshot::text like '%Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.%';

update public.workout_edit_revisions
set before_snapshot = replace(
      before_snapshot::text,
      'Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.',
      'Step 2: Take one dribble. Step 3: Rip the ball low below the defender''s hip on the inside.'
    )::jsonb,
    after_snapshot = replace(
      after_snapshot::text,
      'Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.',
      'Step 2: Take one dribble. Step 3: Rip the ball low below the defender''s hip on the inside.'
    )::jsonb
where before_snapshot::text like '%Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.%'
   or after_snapshot::text like '%Step 2: Rip the ball low below the defender''s hip on the inside. Step 3: Take one dribble.%';
