-- Right and Left Pounds alternates hands within every set, so its workout
-- sets must not be split into separate left/right-side prescriptions.
update public.exercise_video_clips
set requires_both_sides = false
where lower(exercise_name) = 'right and left pounds';

update public.workout_exercises
set set_side_labels = null
where lower(name) = 'right and left pounds';
