// Activation-gated voice coach hook with wake-word listening and cost controls.

import {
  appendConversationSummary,
  type CoachUsageTotals,
} from "@/lib/coachUsage";
import {
  type CoachMachineState,
  canStartRealtime,
  isRealtimeActive,
  isWakeWordAllowed,
} from "@/lib/coachStateMachine";
import { stopLocalConfirmation } from "@/lib/localCoachFeedback";
import {
  RealtimeCoachSession,
  type ClientTimerAction,
  type TimerState,
} from "@/lib/realtimeCoach";
import { WakeWordDetector } from "@/lib/wakeWordDetector";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type CoachStatus = CoachMachineState;

export interface UseCoachResult {
  status: CoachStatus;
  error: string | null;
  wakeHint: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  lastUsage: CoachUsageTotals | null;
  /** Tap orb or wake phrase — connect to Realtime coach. */
  activateCoach: () => Promise<void>;
  /** Fully close overlay / end coach presence. */
  shutdownCoach: () => Promise<void>;
  toggleTimer: () => void;
}

export function useCoach(dayId: string | null): UseCoachResult {
  const sessionRef = useRef<RealtimeCoachSession | null>(null);
  const wakeRef = useRef<WakeWordDetector | null>(null);
  const timerRef = useRef({ running: false, accumulated: 0, startedAt: 0 });
  const conversationSummaryRef = useRef("");
  const activatingRef = useRef(false);
  const mountedRef = useRef(true);
  const activateCoachRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<CoachStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [wakeHint, setWakeHint] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastUsage, setLastUsage] = useState<CoachUsageTotals | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  const ensureWakeDetector = useCallback(() => {
    if (!wakeRef.current) {
      wakeRef.current = new WakeWordDetector();
    }
    return wakeRef.current;
  }, []);

  const stopWakeWord = useCallback(async () => {
    await wakeRef.current?.stop();
  }, []);

  const startWakeWord = useCallback(async () => {
    if (!mountedRef.current || !dayId) return;
    const wake = ensureWakeDetector();
    const started = await wake.start({
      onWake: () => {
        if (!mountedRef.current) return;
        void activateCoachRef.current();
      },
      onUnavailable: (reason) => {
        if (!mountedRef.current) return;
        setWakeHint(reason);
      },
      onError: (message) => {
        if (!mountedRef.current) return;
        setWakeHint(message);
      },
    });
    if (started && mountedRef.current) {
      setStatus("wake_word_listening");
      setWakeHint(null);
    }
  }, [dayId, ensureWakeDetector]);

  const resumeWakeListening = useCallback(async () => {
    if (!mountedRef.current) return;
    await stopWakeWord();
    setError(null);
    await startWakeWord();
  }, [startWakeWord, stopWakeWord]);

  const activateCoach = useCallback(async () => {
    if (!dayId) {
      setError("No active workout day.");
      setStatus("error");
      return;
    }
    if (activatingRef.current || isRealtimeActive(status)) return;
    if (!canStartRealtime(status)) return;

    activatingRef.current = true;
    setError(null);
    await stopWakeWord();
    stopLocalConfirmation();

    const session = ensureSession();
    try {
      await session.connect(dayId, getTimerState(), conversationSummaryRef.current, {
        onStatus: (next) => {
          if (!mountedRef.current) return;
          setStatus(next);
          if (next === "idle") {
            void resumeWakeListening();
          }
        },
        onError: (msg) => {
          if (!mountedRef.current) return;
          setError(msg);
          setStatus("error");
        },
        onTimerAction: applyTimerAction,
        onLocalConfirmation: (message) => {
          conversationSummaryRef.current = appendConversationSummary(
            conversationSummaryRef.current,
            message
          );
        },
        onConversationSummary: (summary) => {
          conversationSummaryRef.current = summary;
        },
        onUsage: (totals) => {
          if (!mountedRef.current) return;
          setLastUsage(totals);
        },
      });
    } catch {
      await resumeWakeListening();
    } finally {
      activatingRef.current = false;
    }
  }, [
    dayId,
    status,
    ensureSession,
    getTimerState,
    applyTimerAction,
    stopWakeWord,
    resumeWakeListening,
  ]);

  activateCoachRef.current = activateCoach;

  const shutdownCoach = useCallback(async () => {
    activatingRef.current = false;
    await sessionRef.current?.disconnect("overlay_closed");
    sessionRef.current = null;
    await stopWakeWord();
    wakeRef.current = null;
    stopLocalConfirmation();
    if (mountedRef.current) {
      setStatus("idle");
      setError(null);
      setWakeHint(null);
    }
  }, [stopWakeWord]);

  useEffect(() => {
    if (!dayId) return;

    void (async () => {
      setStatus("wake_word_listening");
      await startWakeWord();
    })();

    return () => {
      void shutdownCoach();
    };
  }, [dayId, startWakeWord, shutdownCoach]);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (isRealtimeActive(status)) {
          void sessionRef.current?.disconnect("background");
          void resumeWakeListening();
        } else if (isWakeWordAllowed(status)) {
          void stopWakeWord();
        }
      } else if (next === "active" && dayId && (status === "idle" || status === "wake_word_listening")) {
        if (status === "idle") {
          void resumeWakeListening();
        }
      }
    };

    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, [status, dayId, resumeWakeListening, stopWakeWord]);

  return {
    status,
    error,
    wakeHint,
    timerRunning,
    elapsedSeconds,
    lastUsage,
    activateCoach,
    shutdownCoach,
    toggleTimer,
  };
}
