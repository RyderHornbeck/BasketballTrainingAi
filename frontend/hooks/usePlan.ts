import {
  getActivePlan,
  getLatestGenerationRequest,
  getWorkoutDays,
  requestNextBlockGeneration,
} from "@/lib/plan";
import { reportNetworkFailure } from "@/lib/connectivity";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { PlanGenerationRequest, WorkoutDay, WorkoutPlan } from "@/types/database";
import { AppState } from "@/types/plan";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState as NativeAppState } from "react-native";
import { useAuth } from "./useAuth";

interface UsePlanResult {
  appState: AppState;
  plan: WorkoutPlan | null;
  days: WorkoutDay[];
  generationRequest: PlanGenerationRequest | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;
const PLAN_LOAD_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reportNetworkFailure("plan-timeout");
      reject(new Error(`${label} timed out. Check your connection and try again.`));
    }, PLAN_LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

/**
 * Central hook that figures out where the user is in the app lifecycle:
 * logged out -> onboarding incomplete -> no plan -> generating -> failed -> ready.
 * Polls the generation request while a plan is being built.
 */
export function usePlan(): UsePlanResult {
  const { user, profile, loading: authLoading, startupError } = useAuth();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [generationRequest, setGenerationRequest] = useState<PlanGenerationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rolloverAttemptRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Keep the initial plan load pending until auth has resolved. Otherwise
    // the first render sees a temporary null user, marks plan loading done,
    // and dismisses the native splash before the real user's plan is read.
    if (authLoading) return;
    if (!user) {
      setPlan(null);
      setDays([]);
      setGenerationRequest(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    try {
      setLoadError(null);
      const [queriedPlan, latestRequest] = await Promise.all([
        withTimeout(getActivePlan(), "Plan loading"),
        withTimeout(getLatestGenerationRequest(), "Plan status loading"),
      ]);

      // These two requests run concurrently. Generation can commit between
      // them, leaving us with a completed request but a stale null/old plan.
      // Once completion is visible, a follow-up plan read is guaranteed to
      // observe that committed transaction.
      const activePlan =
        latestRequest?.status === "completed" &&
        latestRequest.generation_type === "initial"
          ? await withTimeout(getActivePlan(), "Generated plan loading")
          : queriedPlan;

      setPlan(activePlan);
      setGenerationRequest(latestRequest);

      if (activePlan) {
        const planDays = await withTimeout(getWorkoutDays(activePlan.id), "Workout loading");
        setDays(planDays);
      } else {
        setDays([]);
      }
    } catch (err) {
      console.error("usePlan load error:", err);
      setLoadError(err instanceof Error ? err.message : "Unable to load your workouts.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    return onWorkoutUpdated((source) => {
      if (source === "external") {
        void load();
      }
    });
  }, [load]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshAtNextMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 2, 0);
      timer = setTimeout(() => {
        void load();
        refreshAtNextMidnight();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime()));
    };

    refreshAtNextMidnight();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const isGenerating = generationRequest?.status === "pending" || generationRequest?.status === "generating";

  useEffect(() => {
    if (!plan || days.length === 0 || isGenerating) return;
    const maxDayNumber = Math.max(...days.map((day) => day.day_number ?? 0));
    const blockExhausted = maxDayNumber > 0 && days.every((day) => day.completed);
    if (!blockExhausted) return;

    const nextBlockIndex = Math.max(...days.map((day) => day.block_index ?? 1)) + 1;
    const latestExtensionFailed =
      generationRequest?.status === "failed" &&
      generationRequest.generation_type === "extend" &&
      generationRequest.target_plan_id === plan.id &&
      generationRequest.block_index === nextBlockIndex;
    if (latestExtensionFailed) return;

    const attemptKey = `${plan.id}:${nextBlockIndex}`;
    if (rolloverAttemptRef.current === attemptKey) return;
    rolloverAttemptRef.current = attemptKey;
    requestNextBlockGeneration(plan.id, nextBlockIndex)
      .then(load)
      .catch((err) => console.error("Automatic block generation failed:", err));
  }, [days, generationRequest, isGenerating, load, plan]);

  useEffect(() => {
    if (isGenerating) {
      pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isGenerating, load]);

  let appState: AppState = "logged_out";
  const profilePending = !!user && !profile && !startupError;

  if (authLoading || loading || profilePending) {
    appState = "logged_out";
  } else if (!user) {
    appState = "logged_out";
  } else if (!profile?.onboarding_completed) {
    appState = "onboarding_incomplete";
  } else if (isGenerating && generationRequest?.generation_type !== "extend") {
    appState = "plan_generating";
  } else if (generationRequest?.status === "failed" && !plan) {
    appState = "plan_failed";
  } else if (!plan) {
    appState = "no_plan";
  } else {
    appState = "plan_ready";
  }

  return {
    appState,
    plan,
    days,
    generationRequest,
    loading: authLoading || loading || profilePending,
    loadError,
    refresh: load,
  };
}
