import { LogType } from "@/types/database";
import { WorkoutExerciseWithClip } from "@/types/plan";

export const SET_LOG_META_PREFIX = "__hoop_set_logs__:";

export interface SetLogEntry {
  set_number: number;
  completed: boolean;
  force_incomplete?: boolean;
  duration_seconds_override?: number | null;
  target_makes_override?: number | null;
  target_attempts_override?: number | null;
  makes: number | null;
  attempts: number | null;
  minutes: number | null;
}

export interface ExerciseLogMeta {
  set_logs?: SetLogEntry[];
  user_notes?: string | null;
  per_set_attempts_override?: number | null;
  per_set_minutes_override?: number | null;
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
  const minuteMatch = value.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (minuteMatch) return Number.parseFloat(minuteMatch[1]);
  const secondMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:sec|second)/i);
  return secondMatch ? Number.parseFloat(secondMatch[1]) / 60 : null;
}

export function buildSetPlan(exercise: WorkoutExerciseWithClip): ExerciseSetPlan {
  const setCount = parseSetCount(exercise.sets);
  const logType = (exercise.log_type ?? "checkbox") as LogType;
  // Target makes is retained only as generator metadata. Runtime workout
  // behavior is driven exclusively by the prescribed attempt count.
  const perSetMakes = null;
  const perSetAttempts = exercise.target_attempts ?? null;
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
    const seconds = Math.round(perSetMinutes * 60);
    const minLabel =
      seconds < 60
        ? `${seconds} seconds`
        : perSetMinutes === 1
          ? "1 minute"
          : `${perSetMinutes} minutes`;
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
  const hasAttemptsOverride = meta.per_set_attempts_override != null;
  const hasMinutesOverride = meta.per_set_minutes_override != null;
  if (!hasSets && !hasNotes && !hasAttemptsOverride && !hasMinutesOverride) return null;
  return SET_LOG_META_PREFIX + JSON.stringify(meta);
}

export function scaleTargetMakes(
  baseMakes: number | null,
  baseAttempts: number | null,
  nextAttempts: number | null
): number | null {
  if (baseMakes == null || baseAttempts == null || baseAttempts <= 0) return baseMakes;
  if (nextAttempts == null || nextAttempts <= 0) return baseMakes;
  return Math.max(1, Math.round((nextAttempts / baseAttempts) * baseMakes));
}

export function applyAttemptsOverride(
  plan: ExerciseSetPlan,
  attemptsOverride: number | null | undefined
): ExerciseSetPlan {
  if (plan.logType !== "makes_attempts" || attemptsOverride == null || attemptsOverride <= 0) {
    return plan;
  }
  return {
    ...plan,
    perSetAttempts: attemptsOverride,
    perSetMakes: scaleTargetMakes(plan.perSetMakes, plan.perSetAttempts, attemptsOverride),
  };
}

export function applyMinutesOverride(
  plan: ExerciseSetPlan,
  minutesOverride: number | null | undefined
): ExerciseSetPlan {
  if (plan.perSetMinutes == null || minutesOverride == null || minutesOverride <= 0) {
    return plan;
  }
  return { ...plan, perSetMinutes: minutesOverride };
}

export function resolveMinutesOverride(meta: ExerciseLogMeta): number | null {
  return meta.per_set_minutes_override != null && meta.per_set_minutes_override > 0
    ? meta.per_set_minutes_override
    : null;
}

export function resolveAttemptsOverride(
  _meta: ExerciseLogMeta,
  _setLogs: SetLogEntry[]
): number | null {
  // Historical builds wrote observed progress into this legacy override.
  // The workout exercise target is now the sole source of truth.
  return null;
}

export function createEmptySetLogs(plan: ExerciseSetPlan): SetLogEntry[] {
  return Array.from({ length: plan.setCount }, (_, i) => ({
    set_number: i + 1,
    completed: false,
    makes: null,
    attempts: null,
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
    if (match) {
      return {
        ...row,
        ...match,
        set_number: row.set_number,
      };
    }

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
  if (entry.force_incomplete) return false;
  if (entry.completed) return true;
  if (plan.logType === "makes_attempts") {
    const attempts = entry.attempts ?? 0;
    const targetAttempts =
      entry.target_attempts_override ?? plan.perSetAttempts ?? 0;
    return entry.makes != null && targetAttempts > 0 && attempts >= targetAttempts;
  }
  return false;
}

export function targetMakesForSet(
  entry: SetLogEntry,
  plan: ExerciseSetPlan
): number | null {
  return entry.target_makes_override ?? plan.perSetMakes;
}

export function targetAttemptsForSet(
  entry: SetLogEntry,
  plan: ExerciseSetPlan
): number | null {
  return entry.target_attempts_override ?? plan.perSetAttempts;
}

export function normalizeSetLogs(setLogs: SetLogEntry[], plan: ExerciseSetPlan): SetLogEntry[] {
  return setLogs.map((entry) => ({
    ...entry,
    completed: isSetComplete(entry, plan),
    attempts: entry.attempts,
  }));
}

export interface ObservedShotTotals {
  makes: number;
  attempts: number;
}

/** Counts recorded shots without treating untouched target-filled rows as activity. */
export function observedShotResult(entry: SetLogEntry): ObservedShotTotals | null {
  if (!entry.completed && entry.makes == null) return null;
  const makes = entry.makes ?? 0;
  const attempts = entry.attempts ?? makes;
  return attempts > 0 ? { makes, attempts } : null;
}

export function aggregateObservedShots(setLogs: SetLogEntry[]): ObservedShotTotals | null {
  let makes = 0;
  let attempts = 0;
  for (const entry of setLogs) {
    const observed = observedShotResult(entry);
    if (!observed) continue;
    makes += observed.makes;
    attempts += observed.attempts;
  }
  return attempts > 0 ? { makes, attempts } : null;
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
    // Empty rows carry target attempts for display. They are not recorded
    // attempts until that set has actually been completed.
    if (plan.logType === "makes_attempts" && !entry.completed) continue;
    if (entry.makes != null) {
      makes += entry.makes;
      hasMakes = true;
    }
    if (entry.attempts != null) {
      attempts += entry.attempts;
    } else {
      attempts += targetAttemptsForSet(entry, plan) ?? 0;
    }
    if (entry.minutes != null) {
      minutes += entry.minutes;
      hasMinutes = true;
    } else if (
      entry.completed &&
      (entry.duration_seconds_override != null || plan.perSetMinutes != null)
    ) {
      minutes += entry.duration_seconds_override != null
        ? entry.duration_seconds_override / 60
        : plan.perSetMinutes!;
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
    force_incomplete: false,
    makes: entry.makes ?? targetMakesForSet(entry, plan),
    attempts: entry.attempts ?? targetAttemptsForSet(entry, plan),
    minutes:
      entry.minutes ??
      (entry.duration_seconds_override != null
        ? entry.duration_seconds_override / 60
        : plan.perSetMinutes),
  }));
}

export function clearSetLogs(plan: ExerciseSetPlan): SetLogEntry[] {
  return createEmptySetLogs(plan);
}
