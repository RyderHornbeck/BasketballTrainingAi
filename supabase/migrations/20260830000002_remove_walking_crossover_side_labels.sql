-- Walking Crossover alternates hands within each set, so it should not be
-- prescribed as separate left/right-side sets.
update public.exercise_video_clips
set requires_both_sides = false
where lower(exercise_name) = 'walking crossover';

update public.workout_exercises
set set_side_labels = null
where lower(name) = 'walking crossover';
