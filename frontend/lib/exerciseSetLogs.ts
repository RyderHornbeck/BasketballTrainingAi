import { LogType } from "@/types/database";
import { WorkoutExerciseWithClip } from "@/types/plan";

export const SET_LOG_META_PREFIX = "__hoop_set_logs__:";

export interface SetLogEntry {
  set_number: number;
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutes: number | null;
}

export interface ExerciseLogMeta {
  set_logs?: SetLogEntry[];
  user_notes?: string | null;
}

export interface ExerciseSetPlan {
  setCount: number;
  logType: LogType;
  perSetMakes: number | null;
  perSetAttempts: number | null;
  perSetMinutes: number | null;
  setSideLabels: string[] | null;
  prescriptionLabel: string;
}

export function parseSetCount(sets: string | null | undefined): number {
  const n = parseInt(sets ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseMinutesFromText(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*min/i);
  return match ? parseInt(match[1], 10) : null;
}

export function buildSetPlan(exercise: WorkoutExerciseWithClip): ExerciseSetPlan {
  const setCount = parseSetCount(exercise.sets);
  const logType = (exercise.log_type ?? "checkbox") as LogType;
  const perSetMakes = exercise.target_makes ?? null;
  const perSetAttempts = exercise.target_attempts ?? perSetMakes;
  const perSetMinutes =
    parseMinutesFromText(exercise.duration) ?? parseMinutesFromText(exercise.reps);
  const setSideLabels = exercise.set_side_labels ?? null;

  let prescriptionLabel = "";
  if (logType === "makes_attempts" && perSetAttempts != null) {
    const shotLabel = perSetAttempts === 1 ? "1 shot" : `${perSetAttempts} shots`;
    prescriptionLabel =
      setCount === 1 ? `1 set · ${shotLabel}` : `${setCount} sets · ${shotLabel} each`;
    if (setSideLabels?.length) prescriptionLabel += " · alternate sides";
  } else if (logType === "minutes" && perSetMinutes != null) {
    const minLabel = perSetMinutes === 1 ? "1 minute" : `${perSetMinutes} minutes`;
    prescriptionLabel =
      setCount === 1 ? `1 set · ${minLabel}` : `${setCount} sets · ${minLabel} each`;
  } else if (setCount > 1) {
    prescriptionLabel = `${setCount} sets`;
  } else if (logType === "checkbox") {
    prescriptionLabel = "1 set";
  }

  return {
    setCount,
    logType,
    perSetMakes,
    perSetAttempts,
    perSetMinutes,
    setSideLabels,
    prescriptionLabel,
  };
}

export function decodeExerciseLogMeta(notes: string | null | undefined): ExerciseLogMeta {
  if (!notes) return {};
  if (notes.startsWith(SET_LOG_META_PREFIX)) {
    try {
      return JSON.parse(notes.slice(SET_LOG_META_PREFIX.length)) as ExerciseLogMeta;
    } catch {
      return { user_notes: notes };
    }
  }
  return { user_notes: notes };
}

export function encodeExerciseLogMeta(meta: ExerciseLogMeta): string | null {
  const hasSets = (meta.set_logs?.length ?? 0) > 0;
  const hasNotes = Boolean(meta.user_notes?.trim());
  if (!hasSets && !hasNotes) return null;
  return SET_LOG_META_PREFIX + JSON.stringify(meta);
}

export function createEmptySetLogs(plan: ExerciseSetPlan): SetLogEntry[] {
  return Array.from({ length: plan.setCount }, (_, i) => ({
    set_number: i + 1,
    completed: false,
    makes: null,
    attempts: plan.perSetAttempts,
    minutes: null,
  }));
}

export function hydrateSetLogs(
  plan: ExerciseSetPlan,
  meta: ExerciseLogMeta,
  fallback?: {
    completed?: boolean;
    makes?: number | null;
    attempts?: number | null;
    minutes_completed?: number | null;
  }
): SetLogEntry[] {
  const base = createEmptySetLogs(plan);
  const saved = meta.set_logs ?? [];

  return base.map((row) => {
    const match = saved.find((s) => s.set_number === row.set_number);
    if (match) return { ...row, ...match, set_number: row.set_number };

    if (plan.setCount === 1 && fallback) {
      return {
        ...row,
        completed: fallback.completed ?? false,
        makes: fallback.makes ?? null,
        attempts: fallback.attempts ?? row.attempts,
        minutes: fallback.minutes_completed ?? null,
      };
    }
    return row;
  });
}

export function isSetComplete(entry: SetLogEntry, plan: ExerciseSetPlan): boolean {
  if (entry.completed) return true;
  if (plan.logType === "makes_attempts" && plan.perSetMakes != null) {
    return (entry.makes ?? 0) >= plan.perSetMakes;
  }
  return false;
}

export function normalizeSetLogs(setLogs: SetLogEntry[], plan: ExerciseSetPlan): SetLogEntry[] {
  return setLogs.map((entry) => ({
    ...entry,
    completed: isSetComplete(entry, plan),
    attempts: entry.attempts ?? plan.perSetAttempts,
  }));
}

export function aggregateSetLogs(
  setLogs: SetLogEntry[],
  plan: ExerciseSetPlan
): {
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutes_completed: number | null;
} {
  const normalized = normalizeSetLogs(setLogs, plan);
  const completed = normalized.every((s) => s.completed);

  let makes = 0;
  let attempts = 0;
  let hasMakes = false;
  let minutes = 0;
  let hasMinutes = false;

  for (const entry of normalized) {
    if (entry.makes != null) {
      makes += entry.makes;
      hasMakes = true;
    }
    if (entry.attempts != null) {
      attempts += entry.attempts;
    } else if (plan.perSetAttempts != null) {
      attempts += plan.perSetAttempts;
    }
    if (entry.minutes != null) {
      minutes += entry.minutes;
      hasMinutes = true;
    } else if (entry.completed && plan.perSetMinutes != null) {
      minutes += plan.perSetMinutes;
      hasMinutes = true;
    }
  }

  return {
    completed,
    makes: hasMakes ? makes : null,
    attempts: plan.logType === "makes_attempts" ? attempts : null,
    minutes_completed: hasMinutes ? minutes : null,
  };
}

export function getCurrentSetNumber(setLogs: SetLogEntry[], plan: ExerciseSetPlan): number | null {
  const normalized = normalizeSetLogs(setLogs, plan);
  const current = normalized.find((s) => !s.completed);
  return current?.set_number ?? null;
}

export function markAllSetsComplete(setLogs: SetLogEntry[], plan: ExerciseSetPlan): SetLogEntry[] {
  return setLogs.map((entry) => ({
    ...entry,
    completed: true,
    makes: entry.makes ?? plan.perSetMakes,
    attempts: entry.attempts ?? plan.perSetAttempts,
    minutes: entry.minutes ?? plan.perSetMinutes,
  }));
}

export function clearSetLogs(plan: ExerciseSetPlan): SetLogEntry[] {
  return createEmptySetLogs(plan);
}
