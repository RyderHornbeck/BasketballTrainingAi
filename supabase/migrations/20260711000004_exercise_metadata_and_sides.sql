-- Exercise catalog metadata + per-workout side labels for bilateral drills.

alter table exercise_video_clips
  add column if not exists requires_both_sides boolean not null default false;

alter table workout_exercises
  add column if not exists set_side_labels text[];

update workout_exercises we
set instructions = evc.description
from exercise_video_clips evc
where we.video_clip_id = evc.id
  and evc.description is not null
  and (we.instructions is null or we.instructions = 'Focus on quality reps.');
