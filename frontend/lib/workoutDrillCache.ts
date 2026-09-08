import { WorkoutExerciseWithClip } from "@/types/plan";

const exercises = new Map<string, WorkoutExerciseWithClip>();

function key(dayId: string, exerciseId: string) {
  return `${dayId}:${exerciseId}`;
}

export function primeWorkoutDrillCache(dayId: string, rows: WorkoutExerciseWithClip[]): void {
  rows.forEach((exercise) => exercises.set(key(dayId, exercise.id), exercise));
}

export function setCachedWorkoutDrill(dayId: string, exercise: WorkoutExerciseWithClip): void {
  exercises.set(key(dayId, exercise.id), exercise);
}

export function getCachedWorkoutDrill(
  dayId: string | undefined,
  exerciseId: string | undefined,
): WorkoutExerciseWithClip | null {
  if (!dayId || !exerciseId) return null;
  return exercises.get(key(dayId, exerciseId)) ?? null;
}
