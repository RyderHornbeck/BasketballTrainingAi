-- Retire these catalog drills without changing existing workout history.
update public.exercise_video_clips
set active = false
where lower(trim(exercise_name)) = 'spider dribble'
   or lower(exercise_name) like '%flight 23 drill%';
