// Always-on voice coach while the overlay is open (no wake phrase).

import {
  type CoachUsageTotals,
  COACH_LIMIT_MESSAGES,
  type CoachDailyBudget,
  coachDailyBudgetFromUsage,
  fetchDailyCoachBudget,
  isCoachLimitMessage,
} from "@/lib/coachUsage";
import { emitWorkoutUpdated, onWorkoutUpdated } from "@/lib/coachEvents";
import { type CoachMachineState } from "@/lib/coachStateMachine";
import {
  RealtimeCoachSession,
  type ClientTimerAction,
  type RecognizedCoachCommand,
  type TimerState,
} from "@/lib/realtimeCoach";
import { useTimerAudioCues } from "@/hooks/useTimerAudioCues";
import { completeTimedExerciseSet } from "@/lib/timedSetCompletion";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type CoachStatus = CoachMachineState;

export interface UseCoachResult {
  status: CoachStatus;
  error: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  timerDurationSeconds: number | null;
  commandHeard: RecognizedCoachCommand | null;
  lastUsage: CoachUsageTotals | null;
  dailyBudget: CoachDailyBudget | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  toggleMute: () => void;
  toggleTimer: () => void;
}

export function useCoach(dayId: string | null): UseCoachResult {
  const sessionRef = useRef<RealtimeCoachSession | null>(null);
  const timerRef = useRef({
    running: false,
    accumulated: 0,
    startedAt: 0,
    durationSeconds: null as number | null,
    exerciseId: null as string | null,
    setNumber: null as number | null,
  });
  const timerRunIdRef = useRef(0);
  const conversationSummaryRef = useRef("");
  const conversationDayIdRef = useRef<string | null>(null);
  const connectingRef = useRef(false);
  const overlayOpenRef = useRef(true);
  const mountedRef = useRef(true);
  const limitBlockedRef = useRef(false);
  const dailySpentBaselineRef = useRef(0);
  const startSessionRef = useRef<() => Promise<void>>(async () => {});
  const teardownRef = useRef<Promise<void>>(Promise.resolve());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<CoachStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerDurationSeconds, setTimerDurationSeconds] = useState<number | null>(null);
  const [commandHeard, setCommandHeard] = useState<RecognizedCoachCommand | null>(null);
  const [lastUsage, setLastUsage] = useState<CoachUsageTotals | null>(null);
  const [dailyBudget, setDailyBudget] = useState<CoachDailyBudget | null>(null);
  const [muted, setMuted] = useState(false);
  const timerAudio = useTimerAudioCues();
  const commandHeardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markLimitReached = useCallback((msg: string) => {
    limitBlockedRef.current = true;
    setStatus("budget_exhausted");
    setError(msg);
  }, []);

  const refreshDailyBudget = useCallback(async () => {
    try {
      const budget = await fetchDailyCoachBudget();
      if (!mountedRef.current) return budget;
      dailySpentBaselineRef.current = budget.spentUsd;
      if (budget.exhausted) {
        markLimitReached(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
      }
      setDailyBudget(budget);
      return budget;
    } catch (err) {
      console.warn("Failed to load coach budget:", err);
      return null;
    }
  }, [markLimitReached]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (commandHeardTimeoutRef.current) clearTimeout(commandHeardTimeoutRef.current);
    };
  }, []);

  const showCommandHeard = useCallback((event: RecognizedCoachCommand) => {
    if (!mountedRef.current) return;
    if (commandHeardTimeoutRef.current) clearTimeout(commandHeardTimeoutRef.current);
    setCommandHeard(event);
    commandHeardTimeoutRef.current = setTimeout(() => {
      commandHeardTimeoutRef.current = null;
      if (mountedRef.current) setCommandHeard(null);
    }, 2_000);
  }, []);

  const currentElapsed = useCallback(() => {
    const t = timerRef.current;
    return Math.round(t.accumulated + (t.running ? (Date.now() - t.startedAt) / 1000 : 0));
  }, []);

  const getTimerState = useCallback(
    (): TimerState => ({
      running: timerRef.current.running,
      elapsed_seconds: currentElapsed(),
      duration_seconds: timerRef.current.durationSeconds,
    }),
    [currentElapsed]
  );

  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      const t = timerRef.current;
      const elapsed = currentElapsed();
      const remaining = t.durationSeconds == null ? null : Math.max(0, t.durationSeconds - elapsed);

      if (remaining != null) {
        timerAudio.sync(
          timerRunIdRef.current,
          t.durationSeconds,
          remaining,
          t.running
        );
      }
      if (remaining === 0 && t.running) {
        t.running = false;
        t.accumulated = t.durationSeconds ?? elapsed;
        setTimerRunning(false);
        if (dayId && t.exerciseId && t.setNumber && t.durationSeconds) {
          void completeTimedExerciseSet(
            dayId,
            t.exerciseId,
            t.setNumber,
            t.durationSeconds
          )
            .then(() => sessionRef.current?.refreshWorkoutContext())
            .catch((error) => {
              console.error("Failed to complete timed set:", error);
            });
        }
      }

      setElapsedSeconds(t.running ? elapsed : t.accumulated);
      sessionRef.current?.updateTimer(getTimerState());
    }, 1000);
    return () => clearInterval(interval);
  }, [dayId, timerRunning, currentElapsed, getTimerState, timerAudio]);

  const applyTimerAction = useCallback((action: ClientTimerAction) => {
    const t = timerRef.current;
    if (action.type === "pause_timer") {
      if (t.running) {
        t.accumulated += (Date.now() - t.startedAt) / 1000;
        t.running = false;
      }
      timerAudio.pause();
    } else if (action.type === "resume_timer") {
      if (!t.running && t.accumulated > 0) {
        t.startedAt = Date.now();
        t.running = true;
      }
    } else if (action.type === "stop_timer") {
      t.running = false;
      t.accumulated = 0;
      t.startedAt = 0;
      t.durationSeconds = null;
      t.exerciseId = null;
      t.setNumber = null;
      timerRunIdRef.current += 1;
      timerAudio.stopAll();
    } else if (action.type === "start_timer") {
      timerRunIdRef.current += 1;
      t.accumulated = 0;
      t.startedAt = Date.now();
      t.running = true;
      t.durationSeconds = action.duration_seconds ?? null;
      if (action.timer_exercise_id !== undefined) {
        t.exerciseId = action.timer_exercise_id;
      }
      if (action.timer_set_number !== undefined) {
        t.setNumber = action.timer_set_number;
      }
      if (t.durationSeconds) {
        timerAudio.beginRun(timerRunIdRef.current, t.durationSeconds);
      }
    }
    setTimerRunning(t.running);
    setElapsedSeconds(Math.round(t.accumulated));
    setTimerDurationSeconds(t.durationSeconds);
    sessionRef.current?.updateTimer(getTimerState());
  }, [getTimerState, timerAudio]);

  const toggleTimer = useCallback(() => {
    applyTimerAction({
      type: timerRef.current.running
        ? "pause_timer"
        : timerRef.current.accumulated > 0
          ? "resume_timer"
          : "start_timer",
      duration_seconds: timerRef.current.durationSeconds,
    });
  }, [applyTimerAction]);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new RealtimeCoachSession();
    }
    return sessionRef.current;
  }, []);

  const startSession = useCallback(async () => {
    if (!dayId || !overlayOpenRef.current || limitBlockedRef.current) {
      return;
    }
    if (connectingRef.current) return;

    const budget = (await refreshDailyBudget()) ?? dailyBudget;
    if (budget?.exhausted || limitBlockedRef.current) {
      return;
    }

    connectingRef.current = true;
    setError(null);

    await teardownRef.current;
    if (!overlayOpenRef.current || !dayId || limitBlockedRef.current) {
      connectingRef.current = false;
      return;
    }
    const session = ensureSession();
    try {
      await session.connect(
        dayId,
        getTimerState(),
        conversationSummaryRef.current,
        {
          onStatus: (next) => {
            if (!mountedRef.current || limitBlockedRef.current) return;
            setStatus(next);
            if (next === "listening" || next === "thinking" || next === "speaking") {
              setError(null);
            }
          },
          onError: (msg) => {
            if (!mountedRef.current) return;
            if (isCoachLimitMessage(msg)) {
              markLimitReached(msg);
              return;
            }
            setStatus("error");
            setError(msg);
          },
          onTimerAction: applyTimerAction,
          onCommandHeard: showCommandHeard,
          onConversationSummary: (summary) => {
            conversationSummaryRef.current = summary;
          },
          onUsage: (totals) => {
            if (!mountedRef.current) return;
            setLastUsage(totals);
          },
          onBudgetUpdate: (spentUsd, budgetUsd) => {
            if (!mountedRef.current) return;
            dailySpentBaselineRef.current = spentUsd;
            const nextBudget = coachDailyBudgetFromUsage(spentUsd, budgetUsd);
            setDailyBudget(nextBudget);
            if (nextBudget.exhausted) {
              markLimitReached(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
            }
          },
          onSessionEnded: (reason) => {
            if (!mountedRef.current || !overlayOpenRef.current || limitBlockedRef.current) return;
            if (
              reason === "daily_budget" ||
              reason === "connect_failed" ||
              reason === "response_limit"
            ) {
              return;
            }
            if (reason === "connection_lost") {
              setStatus("connecting");
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                if (overlayOpenRef.current && !limitBlockedRef.current) {
                  void startSessionRef.current();
                }
              }, 1_000);
            }
          },
        },
        {
          dailySpentUsd: budget?.spentUsd ?? dailySpentBaselineRef.current,
          dailyBudgetUsd: budget?.budgetUsd,
        }
      );
      if (muted) session.mute();
    } catch {
      // onError already surfaced the message.
    } finally {
      connectingRef.current = false;
    }
  }, [
    dayId,
    dailyBudget,
    ensureSession,
    getTimerState,
    applyTimerAction,
    showCommandHeard,
    muted,
    refreshDailyBudget,
    markLimitReached,
  ]);

  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  const stopSession = useCallback(async () => {
    overlayOpenRef.current = false;
    connectingRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    teardownRef.current = session?.disconnect("overlay_closed") ?? Promise.resolve();
    await teardownRef.current;
    // The disconnect flushes any locally tracked shots first. Trigger a fresh
    // pull only after that write has finished so the Workouts screen updates.
    emitWorkoutUpdated("coach_progress");
    await refreshDailyBudget();
  }, [refreshDailyBudget]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session || limitBlockedRef.current) return;
    if (muted) {
      session.unmute();
      setMuted(false);
    } else {
      session.mute();
      setMuted(true);
    }
  }, [muted]);

  useEffect(() => {
    if (!dayId) return;

    if (conversationDayIdRef.current !== dayId) {
      conversationDayIdRef.current = dayId;
      conversationSummaryRef.current = "";
    }
    overlayOpenRef.current = true;
    limitBlockedRef.current = false;
    void startSessionRef.current();

    return () => {
      overlayOpenRef.current = false;
      connectingRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      const session = sessionRef.current;
      sessionRef.current = null;
      teardownRef.current = session?.disconnect("overlay_closed") ?? Promise.resolve();
    };
  }, [dayId]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onWorkoutUpdated((source) => {
      // The coach tool response already contains the canonical post-mutation
      // state. Refreshing again here causes a competing session.update.
      if (source === "coach" || source === "coach_progress") return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void sessionRef.current?.refreshWorkoutContext();
      }, 300);
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      // iOS enters "inactive" while the microphone permission sheet and
      // certain audio-route dialogs are visible. Disconnecting there tears
      // down WebRTC before the first connection can finish on a new build.
      if (next === "background") {
        const session = sessionRef.current;
        sessionRef.current = null;
        teardownRef.current = session?.disconnect("background") ?? Promise.resolve();
        return;
      }
      if (next === "active" && dayId && overlayOpenRef.current && !limitBlockedRef.current) {
        void startSessionRef.current();
      }
    };

    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, [dayId]);

  return {
    status,
    error,
    timerRunning,
    elapsedSeconds,
    timerDurationSeconds,
    commandHeard,
    lastUsage,
    dailyBudget,
    startSession,
    stopSession,
    toggleMute,
    toggleTimer,
  };
};
