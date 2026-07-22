-- Retire this drill from every catalog-driven surface. Existing workouts retain
-- their saved exercise rows and history, but no new plan/manual/AI addition can use it.
update public.exercise_video_clips
set active = false
where exercise_name = 'Shooting Footwork (No Ball)';
