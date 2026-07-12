import {
  aggregateSetLogs,
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
  normalizeSetLogs,
} from "@/lib/exerciseSetLogs";
import type { ExerciseLogInput } from "@/lib/plan";
import { WorkoutExerciseWithClip } from "@/types/plan";

export interface DayPerformanceResult {
  score: number;
  hasData: boolean;
}

function getLogForExercise(
  exercise: WorkoutExerciseWithClip,
  logs?: Map<string, ExerciseLogInput>
): ExerciseLogInput | undefined {
  const live = logs?.get(exercise.id);
  if (live) return live;
  if (!exercise.log) return undefined;
  return {
    exercise_id: exercise.id,
    completed: exercise.log.completed,
    makes: exercise.log.makes,
    attempts: exercise.log.attempts,
    minutes_completed: exercise.log.minutes_completed,
    difficulty: exercise.log.difficulty,
    notes: exercise.log.notes,
  };
}

function scoreExercise(exercise: WorkoutExerciseWithClip, log?: ExerciseLogInput): number | null {
  const plan = buildSetPlan(exercise);
  const meta = decodeExerciseLogMeta(log?.notes ?? null);
  const setLogs = hydrateSetLogs(plan, meta, log);
  const normalized = normalizeSetLogs(setLogs, plan);

  const hasStarted = normalized.some(
    (set) => set.completed || (set.makes != null && set.makes > 0)
  );
  if (!hasStarted && !log?.completed) return null;

  if (plan.logType === "makes_attempts") {
    const targetMakes = (plan.perSetMakes ?? 0) * plan.setCount;
    const totals = aggregateSetLogs(normalized, plan);
    const makes = totals.makes ?? 0;

    if (targetMakes > 0) {
      return Math.min(100, Math.round((makes / targetMakes) * 100));
    }

    const setsDone = normalized.filter((set) => set.completed).length;
    return Math.round((setsDone / plan.setCount) * 100);
  }

  if (plan.logType === "difficulty_rating") {
    return log?.difficulty ? Math.min(100, log.difficulty * 20) : null;
  }

  const setsDone = normalized.filter((set) => set.completed).length;
  return Math.round((setsDone / plan.setCount) * 100);
}

/**
 * Blends exercise completion and execution quality (shooting vs targets, set progress).
 * Unstarted drills count as 0. Scores cap at 100 even when targets are exceeded.
 */
export function calculateDayPerformance(
  exercises: WorkoutExerciseWithClip[],
  logs?: Map<string, ExerciseLogInput>
): DayPerformanceResult {
  if (exercises.length === 0) {
    return { score: 0, hasData: false };
  }

  let totalScore = 0;
  let hasData = false;

  for (const exercise of exercises) {
    const log = getLogForExercise(exercise, logs);
    const drillScore = scoreExercise(exercise, log);

    if (drillScore != null) {
      hasData = true;
      totalScore += drillScore;
    }
  }

  const score = Math.round(totalScore / exercises.length);
  return { score, hasData };
}

export type PerformanceTier = "good" | "medium" | "low";

export function getPerformanceTier(score: number): PerformanceTier {
  if (score >= 75) return "good";
  if (score >= 50) return "medium";
  return "low";
}

export function getPerformanceColor(
  score: number,
  colors: { success: string; warning: string; danger: string }
): string {
  const tier = getPerformanceTier(score);
  if (tier === "good") return colors.success;
  if (tier === "medium") return colors.warning;
  return colors.danger;
}
