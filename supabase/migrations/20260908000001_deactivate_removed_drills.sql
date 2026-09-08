-- Keep drills explicitly removed from Court Coach out of both catalogs.
-- Existing user workout rows are intentionally left untouched.
update public.exercise_video_clips
set active = false
where lower(trim(exercise_name)) in (
  'scissor dribbles',
  'continuous scissor dribble',
  'jogging with dribbling',
  'lateral dribbles',
  'lateral dribble with between the legs',
  '1-2 footwork shooting lateral',
  'hot lava shooting',
  'form shot near the rim',
  'knee touch finishes'
);
