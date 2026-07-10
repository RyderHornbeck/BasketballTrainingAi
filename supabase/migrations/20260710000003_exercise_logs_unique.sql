-- Each workout_exercise instance should only ever have a single log row
-- (the app upserts logs by exercise_id as the user edits them).
alter table exercise_logs
  add constraint unique_exercise_log unique (exercise_id);
