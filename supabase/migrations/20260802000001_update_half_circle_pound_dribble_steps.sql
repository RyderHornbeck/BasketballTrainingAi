-- Keep the catalog and already-generated workout instructions consistent.
update public.exercise_video_clips
set description = 'Start at half court in an athletic stance with the ball in your right hand. Step 1: Pound the ball hard in a half-circle arc on the floor, from the front of your body to behind your body on the right side, using your right hand. Step 2: Pound the ball back to the front in the same arc, then switch to your left hand and repeat Steps 1–2 on the left side. Step 3: Keep the half-circle smooth and the dribble at waist height. Do 10 half-circles starting with your right hand, then 10 starting with your left.'
where id = '61e0e452-a59b-47be-bfb3-d2d2a02487f0';

update public.workout_exercises
set instructions = 'Start at half court in an athletic stance with the ball in your right hand. Step 1: Pound the ball hard in a half-circle arc on the floor, from the front of your body to behind your body on the right side, using your right hand. Step 2: Pound the ball back to the front in the same arc, then switch to your left hand and repeat Steps 1–2 on the left side. Step 3: Keep the half-circle smooth and the dribble at waist height. Do 10 half-circles starting with your right hand, then 10 starting with your left.'
where video_clip_id = '61e0e452-a59b-47be-bfb3-d2d2a02487f0';
