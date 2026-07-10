// Real-time voice coach hook powered by OpenAI Realtime API (WebRTC).
//
// Opens a persistent speech-to-speech session when the coach overlay is shown.
// The model handles turn detection (semantic VAD), audio in/out, and tool
// calls; workout updates go through the coach-tools Edge Function.

import {
  RealtimeCoachSession,
  type ClientTimerAction,
  type RealtimeCoachStatus,
  type TimerState,
} from "@/lib/realtimeCoach";
import { useCallback, useEffect, useRef, useState } from "react";

export type CoachStatus = RealtimeCoachStatus;

export interface UseCoachResult {
  status: CoachStatus;
  error: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  /** Connect to the realtime coach (mic on). */
  startSession: () => Promise<void>;
  /** Disconnect and release mic. */
  stopSession: () => Promise<void>;
  /** Toggle mic on/off without fully disconnecting when possible. */
  toggleMute: () => Promise<void>;
  toggleTimer: () => void;
}

export function useCoach(dayId: string | null): UseCoachResult {
  const sessionRef = useRef<RealtimeCoachSession | null>(null);
  const timerRef = useRef({ running: false, accumulated: 0, startedAt: 0 });

  const [status, setStatus] = useState<CoachStatus>("muted");
  const [error, setError] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
    if (!dayId) {
      setError("No active workout day.");
      setStatus("error");
      return;
    }

    setError(null);
    const session = ensureSession();

    try {
      await session.connect(dayId, getTimerState(), {
        onStatus: setStatus,
        onError: (msg) => {
          setError(msg);
          setStatus("error");
        },
        onTimerAction: applyTimerAction,
      });
    } catch {
      // onError callback already surfaced the message.
    }
  }, [dayId, ensureSession, getTimerState, applyTimerAction]);

  const stopSession = useCallback(async () => {
    await sessionRef.current?.disconnect();
    setStatus("muted");
  }, []);

  const toggleMute = useCallback(async () => {
    if (status === "muted" || status === "error") {
      await startSession();
    } else {
      sessionRef.current?.mute();
      setStatus("muted");
    }
  }, [status, startSession]);

  useEffect(() => {
    return () => {
      sessionRef.current?.disconnect();
      sessionRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    timerRunning,
    elapsedSeconds,
    startSession,
    stopSession,
    toggleMute,
    toggleTimer,
  };
}
