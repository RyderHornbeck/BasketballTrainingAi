-- Keep existing workout history readable while preserving the catalog's
-- retired status for this drill.
update public.exercises
set name = 'Through the Legs behind the back'
where lower(trim(name)) = 'thru the legs behind the back (curry slide lol)';

update public.exercise_video_clips
set exercise_name = 'Through the Legs behind the back'
where lower(trim(exercise_name)) = 'thru the legs behind the back (curry slide lol)';
