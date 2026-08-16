import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const activeTimedSetCompletions = new Set<Promise<TimedSetCompletionResult>>();
const PENDING_COMPLETIONS_STORAGE_KEY = "@court-coach/pending-timed-set-completions/v1";
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
let pendingCompletions = new Map<string, PendingTimedSetCompletion>();
let pendingCompletionsLoaded: Promise<void> | null = null;
let completionAttempts = new Map<string, Promise<TimedSetCompletionResult>>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export interface PreparedTimedSetCompletion {
  dayId: string;
  exerciseId: string;
}

export interface TimedSetCompletionResult {
  activeExerciseId: string | null;
  activeSetNumber: number | null;
  stateVersion: number;
}

interface PendingTimedSetCompletion {
  dayId: string;
  exerciseId: string;
  setNumber: number;
  durationSeconds: number;
  retryCount: number;
  createdAt: number;
}

function completionKey(
  dayId: string,
  exerciseId: string,
  setNumber: number,
): string {
  return `${dayId}:${exerciseId}:${setNumber}`;
}

async function ensurePendingCompletionsLoaded(): Promise<void> {
  if (pendingCompletionsLoaded) return pendingCompletionsLoaded;
  pendingCompletionsLoaded = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_COMPLETIONS_STORAGE_KEY);
      const saved: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved)) return;
      for (const entry of saved) {
        if (
          entry &&
          typeof entry.dayId === "string" &&
          typeof entry.exerciseId === "string" &&
          Number.isInteger(entry.setNumber) &&
          Number.isInteger(entry.durationSeconds)
        ) {
          pendingCompletions.set(
            completionKey(entry.dayId, entry.exerciseId, entry.setNumber),
            {
              dayId: entry.dayId,
              exerciseId: entry.exerciseId,
              setNumber: entry.setNumber,
              durationSeconds: entry.durationSeconds,
              retryCount: Number.isInteger(entry.retryCount) ? entry.retryCount : 0,
              createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
            },
          );
        }
      }
    } catch (error) {
      // A storage read failure must not prevent the current expiry from being
      // submitted. The server RPC remains the source of truth.
      console.warn("Could not restore pending timed-set completions:", error);
    }
  })();
  return pendingCompletionsLoaded;
}

async function persistPendingCompletions(): Promise<void> {
  await AsyncStorage.setItem(
    PENDING_COMPLETIONS_STORAGE_KEY,
    JSON.stringify([...pendingCompletions.values()]),
  );
}

function scheduleRetry(): void {
  if (retryTimer || pendingCompletions.size === 0) return;
  const retryCount = Math.max(
    ...[...pendingCompletions.values()].map((entry) => entry.retryCount),
  );
  const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingTimedSetCompletions();
  }, delay);
}

async function submitPendingCompletion(
  entry: PendingTimedSetCompletion,
): Promise<TimedSetCompletionResult> {
  const key = completionKey(entry.dayId, entry.exerciseId, entry.setNumber);
  const activeAttempt = completionAttempts.get(key);
  if (activeAttempt) return activeAttempt;
  const attempt = (async () => {
    try {
      const { data, error: completionError } = await supabase.rpc("complete_my_timed_set_v3", {
        p_day_id: entry.dayId,
        p_exercise_id: entry.exerciseId,
        p_set_number: entry.setNumber,
        p_duration_seconds: entry.durationSeconds,
      });
      if (completionError) throw completionError;
      const row = Array.isArray(data) ? data[0] : data;
      const result: TimedSetCompletionResult = {
        activeExerciseId:
          row && typeof row.active_exercise_id === "string" ? row.active_exercise_id : null,
        activeSetNumber:
          row && typeof row.active_set_number === "number" ? row.active_set_number : null,
        stateVersion:
          row && typeof row.state_version === "number" ? row.state_version : 0,
      };
      pendingCompletions.delete(key);
      await persistPendingCompletions();
      emitWorkoutUpdated("coach_progress", { stateVersion: result.stateVersion });
      return result;
    } catch (error) {
      const pending = pendingCompletions.get(key);
      if (pending) {
        pending.retryCount += 1;
        pendingCompletions.set(key, pending);
        await persistPendingCompletions().catch((storageError) => {
          console.warn("Could not persist timed-set completion retry:", storageError);
        });
      }
      scheduleRetry();
      throw error;
    } finally {
      completionAttempts.delete(key);
    }
  })();
  completionAttempts.set(key, attempt);
  return attempt;
}

/** Retries durable timer expiries after reconnect, foreground, or app restart. */
export async function flushPendingTimedSetCompletions(): Promise<TimedSetCompletionResult[]> {
  await ensurePendingCompletionsLoaded();
  const results = await Promise.allSettled(
    [...pendingCompletions.values()].map((entry) => submitPendingCompletion(entry)),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export function getActiveTimedSetCompletion(): Promise<TimedSetCompletionResult[]> | null {
  const active = [...activeTimedSetCompletions];
  return active.length > 0 ? Promise.all(active) : null;
}

/** Preserve the prefetch call site without reading a stale exercise-log snapshot. */
export async function prepareTimedExerciseSetCompletion(
  dayId: string,
  exerciseId: string,
): Promise<PreparedTimedSetCompletion> {
  return { dayId, exerciseId };
}

export function completeTimedExerciseSet(
  dayId: string,
  exerciseId: string,
  setNumber: number,
  durationSeconds: number,
  prepared?: Promise<PreparedTimedSetCompletion>,
): Promise<TimedSetCompletionResult> {
  const completion = completeTimedExerciseSetInternal(
    dayId,
    exerciseId,
    setNumber,
    durationSeconds,
    prepared,
  );
  activeTimedSetCompletions.add(completion);
  const remove = () => activeTimedSetCompletions.delete(completion);
  void completion.then(remove, remove);
  return completion;
}

async function completeTimedExerciseSetInternal(
  dayId: string,
  exerciseId: string,
  setNumber: number,
  durationSeconds: number,
  prepared?: Promise<PreparedTimedSetCompletion>,
): Promise<TimedSetCompletionResult> {
  if (prepared) {
    try {
      const candidate = await prepared;
      if (candidate.dayId !== dayId || candidate.exerciseId !== exerciseId) {
        console.warn("Ignoring mismatched timed-set completion prefetch.");
      }
    } catch (error) {
      console.warn("Timed-set completion prefetch failed.", error);
    }
  }

  await ensurePendingCompletionsLoaded();
  const entry: PendingTimedSetCompletion = {
    dayId,
    exerciseId,
    setNumber,
    durationSeconds: Math.round(durationSeconds),
    retryCount: 0,
    createdAt: Date.now(),
  };
  pendingCompletions.set(completionKey(dayId, exerciseId, setNumber), entry);
  // Persist before the network call. If iOS backgrounds or the process dies
  // during the RPC, the exact completion is retried on the next launch.
  try {
    await persistPendingCompletions();
  } catch (storageError) {
    // Continue with the authoritative RPC even if local storage is temporarily
    // unavailable; keeping a healthy timer from completing would be worse.
    console.warn("Could not persist timed-set completion before submit:", storageError);
  }
  return submitPendingCompletion(entry);
}
