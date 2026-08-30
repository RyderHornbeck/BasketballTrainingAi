-- Retire this drill from the plan-generation catalog without deleting it from
-- prior workouts or historical athlete logs.
update public.exercise_video_clips
set active = false
where lower(exercise_name) = 'knee touch finishes';
