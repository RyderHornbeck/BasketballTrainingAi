import {
  getActivePlan,
  getLatestGenerationRequest,
  getWorkoutDays,
} from "@/lib/plan";
import { PlanGenerationRequest, WorkoutDay, WorkoutPlan } from "@/types/database";
import { AppState } from "@/types/plan";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";

interface UsePlanResult {
  appState: AppState;
  plan: WorkoutPlan | null;
  days: WorkoutDay[];
  generationRequest: PlanGenerationRequest | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Central hook that figures out where the user is in the app lifecycle:
 * logged out -> onboarding incomplete -> no plan -> generating -> failed -> ready.
 * Polls the generation request while a plan is being built.
 */
export function usePlan(): UsePlanResult {
  const { user, profile, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [generationRequest, setGenerationRequest] = useState<PlanGenerationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setPlan(null);
      setDays([]);
      setGenerationRequest(null);
      setLoading(false);
      return;
    }

    try {
      const [activePlan, latestRequest] = await Promise.all([
        getActivePlan(),
        getLatestGenerationRequest(),
      ]);

      setPlan(activePlan);
      setGenerationRequest(latestRequest);

      if (activePlan) {
        const planDays = await getWorkoutDays(activePlan.id);
        setDays(planDays);
      } else {
        setDays([]);
      }
    } catch (err) {
      console.error("usePlan load error:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const isGenerating = generationRequest?.status === "pending" || generationRequest?.status === "generating";

  useEffect(() => {
    if (isGenerating) {
      pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isGenerating, load]);

  let appState: AppState = "logged_out";
  const profilePending = !!user && !profile;

  if (authLoading || loading || profilePending) {
    appState = "logged_out";
  } else if (!user) {
    appState = "logged_out";
  } else if (!profile?.onboarding_completed) {
    appState = "onboarding_incomplete";
  } else if (isGenerating) {
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
    refresh: load,
  };
}
