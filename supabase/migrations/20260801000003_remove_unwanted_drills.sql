-- Retire these drills from plan generation, manual additions, AI editing, and
-- realtime catalog search. Existing workout rows remain intact for history.
update public.exercise_video_clips
set active = false
where lower(trim(exercise_name)) = 'thru the legs behind the back (curry slide lol)'
   or (
     category = 'shooting'
     and (
       lower(trim(exercise_name)) in ('shadow shooting', 'wall shooting')
       or lower(exercise_name) like '%no ball%'
       or lower(coalesce(description, '')) like '%with no ball%'
       or lower(coalesce(description, '')) like '%without a ball%'
       or lower(coalesce(description, '')) like '%imaginary shot%'
     )
   );
