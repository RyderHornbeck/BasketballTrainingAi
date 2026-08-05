import {
  aggregateSetLogs,
  buildSetPlan,
  decodeExerciseLogMeta,
  encodeExerciseLogMeta,
  hydrateSetLogs,
  normalizeSetLogs,
} from "@/lib/exerciseSetLogs";
import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { saveExerciseLog } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { WorkoutExerciseWithClip } from "@/types/plan";

export async function completeTimedExerciseSet(
  dayId: string,
  exerciseId: string,
  setNumber: number,
  durationSeconds: number
): Promise<void> {
  const [{ data: exercise, error: exerciseError }, { data: log, error: logError }] =
    await Promise.all([
      supabase
        .from("workout_exercises")
        .select(
          "id, day_id, video_clip_id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels"
        )
        .eq("id", exerciseId)
        .single(),
      supabase
        .from("exercise_logs")
        .select("*")
        .eq("exercise_id", exerciseId)
        .maybeSingle(),
    ]);
  if (exerciseError) throw exerciseError;
  if (logError) throw logError;

  const plan = buildSetPlan(exercise as WorkoutExerciseWithClip);
  const meta = decodeExerciseLogMeta(log?.notes ?? null);
  const setLogs = hydrateSetLogs(plan, meta, log ?? undefined);
  const normalized = normalizeSetLogs(
    setLogs.map((set) =>
      set.set_number === setNumber
        ? {
            ...set,
            completed: true,
            force_incomplete: false,
            duration_seconds_override: Math.round(durationSeconds),
            minutes: durationSeconds / 60,
          }
        : set
    ),
    plan
  );
  const totals = aggregateSetLogs(normalized, plan);

  await saveExerciseLog(dayId, {
    exercise_id: exerciseId,
    completed: totals.completed,
    makes: totals.makes,
    attempts: totals.attempts,
    minutes_completed: totals.minutes_completed,
    difficulty: log?.difficulty ?? null,
    notes: encodeExerciseLogMeta({
      set_logs: normalized,
      user_notes: meta.user_notes ?? null,
      per_set_attempts_override: meta.per_set_attempts_override ?? null,
      per_set_minutes_override: meta.per_set_minutes_override ?? null,
    }),
  });
  // saveExerciseLog emits "manual", which mounted workout cards intentionally
  // ignore. Timer expiry needs a canonical refresh so the completed set is
  // visible immediately when the timer closes or the coach overlay remains open.
  emitWorkoutUpdated("coach_progress");
}
