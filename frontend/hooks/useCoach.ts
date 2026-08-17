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
  type TimerState,
} from "@/lib/realtimeCoach";
import { type CoachVoiceProvider } from "@/lib/coachVoiceProvider";
import { useTimerAudioCues } from "@/hooks/useTimerAudioCues";
import {
  completeTimedExerciseSet,
  flushPendingTimedSetCompletions,
  prepareTimedExerciseSetCompletion,
} from "@/lib/timedSetCompletion";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type CoachStatus = CoachMachineState;

const coachConversationKey = (dayId: string) =>
  `court-coach:conversation:${dayId}`;
const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 3;

export interface UseCoachResult {
  status: CoachStatus;
  error: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  timerDurationSeconds: number | null;
  userTranscript: string;
  coachTranscript: string;
  coachTranscriptFadeVersion: number;
  lastUsage: CoachUsageTotals | null;
  dailyBudget: CoachDailyBudget | null;
  connectedProvider: CoachVoiceProvider | null;
  providerFallbackReason: string | null;
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
  const timerEncouragementRef = useRef<{
    runId: number;
    fired: Set<"seventy_five" | "twenty_five">;
  }>({ runId: 0, fired: new Set() });
  const timedSetPrefetchRef = useRef<{
    dayId: string;
    exerciseId: string;
    setNumber: number;
    promise: ReturnType<typeof prepareTimedExerciseSetCompletion>;
  } | null>(null);
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
  const reconnectAttemptsRef = useRef(0);
  const coachTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachTranscriptTargetRef = useRef("");
  const coachTranscriptShownWordCountRef = useRef(0);
  const userTranscriptRef = useRef("");
  const transcriptGenerationRef = useRef(0);

  const [status, setStatus] = useState<CoachStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerDurationSeconds, setTimerDurationSeconds] = useState<number | null>(null);
  const [userTranscript, setUserTranscript] = useState("");
  const [coachTranscript, setCoachTranscript] = useState("");
  const [coachTranscriptFadeVersion, setCoachTranscriptFadeVersion] = useState(0);
  const [lastUsage, setLastUsage] = useState<CoachUsageTotals | null>(null);
  const [dailyBudget, setDailyBudget] = useState<CoachDailyBudget | null>(null);
  const [connectedProvider, setConnectedProvider] = useState<CoachVoiceProvider | null>(null);
  const [providerFallbackReason, setProviderFallbackReason] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const timerAudio = useTimerAudioCues();

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
      if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
      if (coachTypingTimerRef.current) clearTimeout(coachTypingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Timed-set expiry is an outbox operation. Retry any durable completion
    // when this Coach screen mounts or the device regains connectivity.
    void flushPendingTimedSetCompletions();
    return NetInfo.addEventListener((network) => {
      if (network.isConnected && network.isInternetReachable !== false) {
        void flushPendingTimedSetCompletions();
      }
    });
  }, []);

  const currentElapsed = useCallback(() => {
    const t = timerRef.current;
    return Math.round(t.accumulated + (t.running ? (Date.now() - t.startedAt) / 1000 : 0));
  }, []);

  const getTimerState = useCallback((): TimerState => {
    const elapsedSeconds = currentElapsed();
    const durationSeconds = timerRef.current.durationSeconds;
    return {
      running: timerRef.current.running,
      elapsed_seconds: elapsedSeconds,
      duration_seconds: durationSeconds,
      remaining_seconds: durationSeconds == null
        ? null
        : Math.max(0, durationSeconds - elapsedSeconds),
    };
  }, [currentElapsed]);

  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      const t = timerRef.current;
      const elapsed = currentElapsed();
      const durationSeconds = t.durationSeconds;
      const remaining =
        durationSeconds == null ? null : Math.max(0, durationSeconds - elapsed);

      if (remaining != null && durationSeconds != null) {
        timerAudio.sync(
          timerRunIdRef.current,
          durationSeconds,
          remaining,
          t.running
        );
        const encouragementState = timerEncouragementRef.current;
        if (encouragementState.runId !== timerRunIdRef.current) {
          encouragementState.runId = timerRunIdRef.current;
          encouragementState.fired = new Set();
        }
        const remainingRatio =
          durationSeconds > 0 ? remaining / durationSeconds : 1;
        const marker =
          remaining > 0 &&
          remainingRatio <= 0.25 &&
          !encouragementState.fired.has("twenty_five")
            ? "twenty_five"
            : remaining > 0 &&
                remainingRatio <= 0.75 &&
                !encouragementState.fired.has("seventy_five")
              ? "seventy_five"
              : null;
        if (marker && sessionRef.current?.announceTimerEncouragement()) {
          encouragementState.fired.add(marker);
        }
      }
      if (
        remaining != null &&
        remaining > 0 &&
        remaining <= 5 &&
        dayId &&
        t.exerciseId &&
        t.setNumber &&
        (
          !timedSetPrefetchRef.current ||
          timedSetPrefetchRef.current.dayId !== dayId ||
          timedSetPrefetchRef.current.exerciseId !== t.exerciseId ||
          timedSetPrefetchRef.current.setNumber !== t.setNumber
        )
      ) {
        timedSetPrefetchRef.current = {
          dayId,
          exerciseId: t.exerciseId,
          setNumber: t.setNumber,
          promise: prepareTimedExerciseSetCompletion(dayId, t.exerciseId),
        };
      }
      if (remaining === 0 && t.running) {
        const completedExerciseId = t.exerciseId;
        const completedSetNumber = t.setNumber;
        const completedDurationSeconds = t.durationSeconds;
        const prefetched =
          timedSetPrefetchRef.current?.dayId === dayId &&
          timedSetPrefetchRef.current.exerciseId === completedExerciseId &&
          timedSetPrefetchRef.current.setNumber === completedSetNumber
            ? timedSetPrefetchRef.current.promise
            : undefined;
        timedSetPrefetchRef.current = null;
        t.running = false;
        // Expiry is completion, not a paused timer. Clearing the local timer
        // before its next snapshot prevents unrelated questions such as
        // "what's next?" from being answered as "paused with 0 seconds left."
        t.accumulated = 0;
        t.startedAt = 0;
        t.durationSeconds = null;
        t.exerciseId = null;
        t.setNumber = null;
        setTimerRunning(false);
        setTimerDurationSeconds(null);
        if (
          dayId &&
          completedExerciseId &&
          completedSetNumber &&
          completedDurationSeconds
        ) {
          const completion = completeTimedExerciseSet(
            dayId,
            completedExerciseId,
            completedSetNumber,
            completedDurationSeconds,
            prefetched,
          );
          // Advance and narrate locally first. The completion remains durable
          // through the outbox, but the athlete should never wait on a network
          // round trip to hear which set comes next.
          sessionRef.current?.transitionTimedSetLocally(
            completedExerciseId,
            completedSetNumber,
          );
          void sessionRef.current?.announceTimedSetCompletion(
            completedExerciseId,
            completedSetNumber,
          ).catch((announcementError) => {
            console.error("Failed to announce timed set completion:", announcementError);
          });
          const synchronized = sessionRef.current
            ? sessionRef.current.syncExternalWorkoutMutation(completion, {
                preserveCurrentSpeech: true,
              })
            : completion;
          void synchronized
            .catch((error) => {
              console.error("Timed set context synchronization failed:", error);
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
      timedSetPrefetchRef.current = null;
      timerRunIdRef.current += 1;
      timerEncouragementRef.current = {
        runId: timerRunIdRef.current,
        fired: new Set(),
      };
      timerAudio.stopAll();
    } else if (action.type === "start_timer") {
      timerRunIdRef.current += 1;
      timerEncouragementRef.current = {
        runId: timerRunIdRef.current,
        fired: new Set(),
      };
      timedSetPrefetchRef.current = null;
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
    if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
    if (coachTypingTimerRef.current) clearTimeout(coachTypingTimerRef.current);
    coachTypingTimerRef.current = null;
    coachTranscriptTargetRef.current = "";
    coachTranscriptShownWordCountRef.current = 0;
    userTranscriptRef.current = "";
    setUserTranscript("");
    setCoachTranscript("");
    setConnectedProvider(null);
    setProviderFallbackReason(null);

    await teardownRef.current;
    if (!overlayOpenRef.current || !dayId || limitBlockedRef.current) {
      connectingRef.current = false;
      return;
    }
    if (!conversationSummaryRef.current) {
      const savedConversation = await AsyncStorage.getItem(
        coachConversationKey(dayId),
      ).catch(() => null);
      if (
        savedConversation &&
        overlayOpenRef.current &&
        conversationDayIdRef.current === dayId
      ) {
        conversationSummaryRef.current = savedConversation.slice(-1_200);
      }
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
              reconnectAttemptsRef.current = 0;
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
          getTimerState,
          onUserTranscript: (text) => {
            if (!mountedRef.current) return;
            transcriptGenerationRef.current += 1;
            const isContinuation =
              userTranscriptRef.current.length > 0 &&
              text.startsWith(userTranscriptRef.current);
            if (!isContinuation) {
              if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
              if (coachTypingTimerRef.current) clearTimeout(coachTypingTimerRef.current);
              coachTypingTimerRef.current = null;
              coachTranscriptTargetRef.current = "";
              coachTranscriptShownWordCountRef.current = 0;
              setCoachTranscriptFadeVersion(0);
              setCoachTranscript("");
            }
            userTranscriptRef.current = text;
            setUserTranscript(text);
          },
          onCoachTranscript: (text) => {
            if (!mountedRef.current) return;
            transcriptGenerationRef.current += 1;
            if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
            setCoachTranscriptFadeVersion(0);
            coachTranscriptTargetRef.current = text;
            if (coachTypingTimerRef.current) return;
            const revealNextWord = () => {
              const words = coachTranscriptTargetRef.current.trim().split(/\s+/).filter(Boolean);
              if (coachTranscriptShownWordCountRef.current >= words.length) {
                coachTypingTimerRef.current = null;
                return;
              }
              coachTranscriptShownWordCountRef.current += 1;
              setCoachTranscript(
                words.slice(0, coachTranscriptShownWordCountRef.current).join(" "),
              );
              coachTypingTimerRef.current = setTimeout(revealNextWord, 150);
            };
            revealNextWord();
          },
          onCoachPlaybackFinished: () => {
            if (!mountedRef.current) return;
            const playbackGeneration = transcriptGenerationRef.current;
            if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
            coachTranscriptTimerRef.current = setTimeout(() => {
              if (
                !mountedRef.current ||
                playbackGeneration !== transcriptGenerationRef.current
              ) return;
              setCoachTranscriptFadeVersion((version) => version + 1);
              coachTranscriptTimerRef.current = setTimeout(() => {
                if (
                  !mountedRef.current ||
                  playbackGeneration !== transcriptGenerationRef.current
                ) return;
                userTranscriptRef.current = "";
                setUserTranscript("");
                setCoachTranscript("");
              }, 250);
            }, 2_000);
          },
          onConversationSummary: (summary) => {
            conversationSummaryRef.current = summary;
            void AsyncStorage.setItem(
              coachConversationKey(dayId),
              summary.slice(-1_200),
            ).catch((storageError) => {
              console.warn(
                "Could not persist coach conversation history:",
                storageError,
              );
            });
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
              reconnectAttemptsRef.current += 1;
              if (reconnectAttemptsRef.current > MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
                setStatus("error");
                setError("Coach audio could not reconnect. Tap to retry.");
                return;
              }
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
          onProviderConnected: (provider) => {
            if (mountedRef.current) setConnectedProvider(provider);
          },
          onProviderFallback: (reason) => {
            if (mountedRef.current) setProviderFallbackReason(reason);
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
    const unsubscribe = onWorkoutUpdated((source, details) => {
      // Coach tool responses already contain the canonical post-mutation
      // state. Timers do not: they may complete from either timer screen, so
      // pull the new cursor immediately and let the session's refresh barrier
      // block any transcript until it is applied.
      if (source === "coach") return;
      if (source === "coach_progress") {
        if (details?.stateVersion != null) {
          sessionRef.current?.noteExternalWorkoutMutationVersion(details.stateVersion);
        }
        void sessionRef.current?.refreshWorkoutContext().catch((error) => {
          console.warn("Failed to refresh Coach after workout progress:", error);
        });
        return;
      }
      if (source === "manual" && details?.stateVersion != null) {
        sessionRef.current?.noteExternalWorkoutMutationVersion(details.stateVersion);
      }
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void sessionRef.current?.refreshWorkoutContext().catch((error) => {
          console.warn("Failed to refresh Coach after workout update:", error);
        });
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
        void flushPendingTimedSetCompletions();
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
    userTranscript,
    coachTranscript,
    coachTranscriptFadeVersion,
    lastUsage,
    dailyBudget,
    connectedProvider,
    providerFallbackReason,
    startSession,
    stopSession,
    toggleMute,
    toggleTimer,
  };
};
