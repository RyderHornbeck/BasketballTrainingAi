-- Correct the catalog's actual Flight23White naming variant and retain
-- existing workout history.
update public.exercise_video_clips
set active = false
where lower(trim(exercise_name)) = 'spider dribble (flight23white dribble)'
   or lower(exercise_name) like '%flight23%'
   or lower(exercise_name) like '%flight 23%';
