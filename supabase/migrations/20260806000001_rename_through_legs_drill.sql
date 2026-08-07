-- Keep existing workout history readable while preserving the catalog's
-- retired status for this drill.
update public.exercise_video_clips
set exercise_name = 'Through the Legs behind the back'
where lower(trim(exercise_name)) = 'thru the legs behind the back (curry slide lol)';
