-- Retire these introductory handling drills from every catalog surface.
-- Existing generated workouts intentionally retain their exercises.
update public.exercise_video_clips
set active = false
where exercise_name = 'Full Body Wraps'
   or lower(exercise_name) like '%figure 8%'
   or lower(exercise_name) like '%figure eight%';
