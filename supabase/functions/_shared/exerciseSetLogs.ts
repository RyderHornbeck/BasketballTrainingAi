// Per-set exercise log encoding — keep in sync with frontend/lib/exerciseSetLogs.ts

export const SET_LOG_META_PREFIX = "__hoop_set_logs__:";

export interface SetLogEntry {
  set_number: number;
  completed: boolean;
  force_incomplete?: boolean;
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
  logType: string;
  perSetMakes: number | null;
  perSetAttempts: number | null;
  perSetMinutes: number | null;
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

export function buildSetPlan(exercise: {
  sets: string | null;
  log_type: string | null;
  target_makes: number | null;
  target_attempts: number | null;
  duration: string | null;
  reps: string | null;
}): ExerciseSetPlan {
  const setCount = parseSetCount(exercise.sets);
  const logType = exercise.log_type ?? "checkbox";
  return {
    setCount,
    logType,
    perSetMakes: exercise.target_makes ?? null,
    perSetAttempts: exercise.target_attempts ?? exercise.target_makes,
    perSetMinutes:
      parseMinutesFromText(exercise.duration) ?? parseMinutesFromText(exercise.reps),
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

function isSetComplete(entry: SetLogEntry, plan: ExerciseSetPlan): boolean {
  if (entry.force_incomplete) return false;
  if (entry.completed) return true;
  if (plan.logType === "makes_attempts") {
    const attempts = entry.attempts ?? 0;
    const targetAttempts = plan.perSetAttempts ?? 0;
    return entry.makes != null && targetAttempts > 0 && attempts >= targetAttempts;
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

export function aggregateSetLogs(setLogs: SetLogEntry[], plan: ExerciseSetPlan) {
  const normalized = normalizeSetLogs(setLogs, plan);
  const completed = normalized.every((s) => s.completed);

  let makes = 0;
  let attempts = 0;
  let hasMakes = false;
  let minutes = 0;
  let hasMinutes = false;

  for (const entry of normalized) {
    // Empty set rows carry their target attempts so the UI can display a
    // prescription. Those are not recorded shot attempts. Count only sets
    // the athlete has completed; otherwise future targets inflate progress
    // summaries and the aggregate persisted on exercise_logs.
    if (plan.logType === "makes_attempts" && !entry.completed) continue;
    if (entry.makes != null) {
      makes += entry.makes;
      hasMakes = true;
    }
    if (entry.attempts != null) attempts += entry.attempts;
    else if (plan.perSetAttempts != null) attempts += plan.perSetAttempts;
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
    set_logs: normalized,
  };
}

export function getCurrentSetNumber(setLogs: SetLogEntry[], plan: ExerciseSetPlan): number | null {
  const normalized = normalizeSetLogs(setLogs, plan);
  return normalized.find((s) => !s.completed)?.set_number ?? null;
}

export function markAllSetsComplete(setLogs: SetLogEntry[], plan: ExerciseSetPlan): SetLogEntry[] {
  return setLogs.map((entry) => ({
    ...entry,
    completed: true,
    force_incomplete: false,
    makes: entry.makes ?? plan.perSetMakes,
    attempts: entry.attempts ?? plan.perSetAttempts,
    minutes: entry.minutes ?? plan.perSetMinutes,
  }));
}

export function clearSetLogs(plan: ExerciseSetPlan): SetLogEntry[] {
  return createEmptySetLogs(plan);
}

export function updateSetLog(
  setLogs: SetLogEntry[],
  plan: ExerciseSetPlan,
  setNumber: number,
  patch: Partial<SetLogEntry>
): SetLogEntry[] {
  return setLogs.map((entry) =>
    entry.set_number === setNumber ? { ...entry, ...patch, set_number: setNumber } : entry
  );
}
