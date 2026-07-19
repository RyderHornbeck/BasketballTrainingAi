import {
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
} from "./exerciseSetLogs.ts";

export function buildWorkoutEditorSnapshot(
  day: Record<string, unknown>,
  exercises: any[],
  logs: any[]
) {
  const logsByExercise = new Map(logs.map((log) => [log.exercise_id, log]));
  return {
    active_exercise_id: day.active_exercise_id ?? null,
    exercises: exercises.map((exercise) => {
      const log = logsByExercise.get(exercise.id) ?? null;
      return {
        exercise,
        log,
        set_progress: hydrateSetLogs(
          buildSetPlan(exercise),
          decodeExerciseLogMeta(log?.notes ?? null),
          log ?? undefined
        ),
      };
    }),
  };
}
