// Always-on voice coach while the overlay is open (no wake phrase).

import {
  type CoachUsageTotals,
  type CoachWorkoutBudget,
  COACH_LIMIT_MESSAGES,
  coachWorkoutBudgetFromUsage,
  fetchWorkoutCoachBudget,
} from "@/lib/coachUsage";
import { type CoachMachineState } from "@/lib/coachStateMachine";
import {
  RealtimeCoachSession,
  type ClientTimerAction,
  type TimerState,
} from "@/lib/realtimeCoach";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type CoachStatus = CoachMachineState;

export interface UseCoachResult {
  status: CoachStatus;
  error: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  lastUsage: CoachUsageTotals | null;
  workoutBudget: CoachWorkoutBudget | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  toggleMute: () => void;
  toggleTimer: () => void;
}

export function useCoach(dayId: string | null): UseCoachResult {
  const sessionRef = useRef<RealtimeCoachSession | null>(null);
  const timerRef = useRef({ running: false, accumulated: 0, startedAt: 0 });
  const conversationSummaryRef = useRef("");
  const connectingRef = useRef(false);
  const overlayOpenRef = useRef(true);
  const mountedRef = useRef(true);
  const budgetExhaustedRef = useRef(false);
  const workoutSpentBaselineRef = useRef(0);
  const startSessionRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<CoachStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastUsage, setLastUsage] = useState<CoachUsageTotals | null>(null);
  const [workoutBudget, setWorkoutBudget] = useState<CoachWorkoutBudget | null>(null);
  const [muted, setMuted] = useState(false);

  const refreshWorkoutBudget = useCallback(async () => {
    if (!dayId) return null;
    try {
      const budget = await fetchWorkoutCoachBudget(dayId);
      if (!mountedRef.current) return budget;
      workoutSpentBaselineRef.current = budget.spentUsd;
      budgetExhaustedRef.current = budget.exhausted;
      setWorkoutBudget(budget);
      if (budget.exhausted) {
        setStatus("budget_exhausted");
        setError(COACH_LIMIT_MESSAGES.workoutBudgetExhausted);
      }
      return budget;
    } catch (err) {
      console.warn("Failed to load coach budget:", err);
      return null;
    }
  }, [dayId]);

  useEffect(() => {
    mountedRef.current = true;
    overlayOpenRef.current = true;
    void refreshWorkoutBudget();
    return () => {
      mountedRef.current = false;
      overlayOpenRef.current = false;
    };
  }, [refreshWorkoutBudget]);

  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      const t = timerRef.current;
      setElapsedSeconds(
        Math.round(t.accumulated + (t.running ? (Date.now() - t.startedAt) / 1000 : 0))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  const currentElapsed = useCallback(() => {
    const t = timerRef.current;
    return Math.round(t.accumulated + (t.running ? (Date.now() - t.startedAt) / 1000 : 0));
  }, []);

  const getTimerState = useCallback(
    (): TimerState => ({
      running: timerRef.current.running,
      elapsed_seconds: currentElapsed(),
    }),
    [currentElapsed]
  );

  const applyTimerAction = useCallback((action: ClientTimerAction) => {
    const t = timerRef.current;
    if (action === "pause_timer") {
      if (t.running) {
        t.accumulated += (Date.now() - t.startedAt) / 1000;
        t.running = false;
      }
    } else if (action === "stop_timer") {
      t.running = false;
      t.accumulated = 0;
      t.startedAt = 0;
    } else if (!t.running) {
      t.startedAt = Date.now();
      t.running = true;
    }
    setTimerRunning(t.running);
    setElapsedSeconds(Math.round(t.accumulated));
    sessionRef.current?.updateTimer(getTimerState());
  }, [getTimerState]);

  const toggleTimer = useCallback(() => {
    applyTimerAction(timerRef.current.running ? "pause_timer" : "start_timer");
  }, [applyTimerAction]);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new RealtimeCoachSession();
    }
    return sessionRef.current;
  }, []);

  const startSession = useCallback(async () => {
    if (!dayId || !overlayOpenRef.current) {
      setError("No active workout day.");
      setStatus("error");
      return;
    }
    if (connectingRef.current) return;

    const budget = (await refreshWorkoutBudget()) ?? workoutBudget;
    if (budget?.exhausted || budgetExhaustedRef.current) {
      setStatus("budget_exhausted");
      setError(COACH_LIMIT_MESSAGES.workoutBudgetExhausted);
      return;
    }

    connectingRef.current = true;
    setError(null);

    const session = ensureSession();
    try {
      await session.connect(
        dayId,
        getTimerState(),
        conversationSummaryRef.current,
        {
          onStatus: (next) => {
            if (!mountedRef.current) return;
            setStatus(next);
          },
          onError: (msg) => {
            if (!mountedRef.current) return;
            if (
              msg === COACH_LIMIT_MESSAGES.workoutBudgetExhausted ||
              msg === COACH_LIMIT_MESSAGES.dailyBudgetExhausted
            ) {
              budgetExhaustedRef.current = true;
              setStatus("budget_exhausted");
            } else {
              setStatus("error");
            }
            setError(msg);
          },
          onTimerAction: applyTimerAction,
          onConversationSummary: (summary) => {
            conversationSummaryRef.current = summary;
          },
          onUsage: (totals) => {
            if (!mountedRef.current) return;
            setLastUsage(totals);
            const spentUsd = workoutSpentBaselineRef.current + totals.estimatedCostUsd;
            setWorkoutBudget(coachWorkoutBudgetFromUsage(spentUsd));
          },
          onBudgetUpdate: (spentUsd, budgetUsd) => {
            if (!mountedRef.current) return;
            const nextBudget = coachWorkoutBudgetFromUsage(spentUsd, budgetUsd);
            budgetExhaustedRef.current = nextBudget.exhausted;
            setWorkoutBudget(nextBudget);
          },
          onSessionEnded: (reason) => {
            if (!mountedRef.current || !overlayOpenRef.current) return;
            if (reason === "workout_budget" || reason === "daily_budget") {
              budgetExhaustedRef.current = true;
              void refreshWorkoutBudget();
              return;
            }
            if (reason === "max_duration" && !budgetExhaustedRef.current) {
              void startSessionRef.current();
            }
          },
        },
        {
          workoutSpentUsd: budget?.spentUsd ?? workoutSpentBaselineRef.current,
          workoutBudgetUsd: budget?.budgetUsd,
        }
      );
      if (muted) session.mute();
    } catch {
      // onError already surfaced the message.
    } finally {
      connectingRef.current = false;
    }
  }, [dayId, workoutBudget, ensureSession, getTimerState, applyTimerAction, muted, refreshWorkoutBudget]);

  startSessionRef.current = startSession;

  const stopSession = useCallback(async () => {
    overlayOpenRef.current = false;
    connectingRef.current = false;
    await sessionRef.current?.disconnect("overlay_closed");
    sessionRef.current = null;
    if (mountedRef.current && status !== "budget_exhausted") {
      setStatus("idle");
      setError(null);
    }
  }, [status]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session || status === "budget_exhausted") return;
    if (muted) {
      session.unmute();
      setMuted(false);
    } else {
      session.mute();
      setMuted(true);
    }
  }, [muted, status]);

  useEffect(() => {
    if (!dayId) return;
    overlayOpenRef.current = true;
    budgetExhaustedRef.current = false;
    void startSessionRef.current();
    return () => {
      void stopSession();
    };
  }, [dayId, stopSession]);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        void sessionRef.current?.disconnect("background");
      } else if (next === "active" && dayId && overlayOpenRef.current && !budgetExhaustedRef.current) {
        void startSession();
      }
    };

    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, [dayId, startSession]);

  return {
    status,
    error,
    timerRunning,
    elapsedSeconds,
    lastUsage,
    workoutBudget,
    startSession,
    stopSession,
    toggleMute,
    toggleTimer,
  };
};
