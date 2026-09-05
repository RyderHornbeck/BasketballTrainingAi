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
  type CoachSttProvider,
  type ClientTimerAction,
  type ShotEventRecordOutcome,
  type TimerState,
  type VideoCoachHudState,
} from "@/lib/realtimeCoach";
import {
  type ShotEventSource,
  type ShotInputMode,
  type ShotResult,
} from "@/lib/shotEventSeam";
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
const STARTUP_BUDGET_TIMEOUT_MS = 8_000;

async function resolveWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
  sttProvider: CoachSttProvider | null;
  providerFallbackReason: string | null;
  audioLevels: { microphone: number; tts: number };
  shotInputMode: ShotInputMode;
  videoHudState: VideoCoachHudState | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  suspendSessionForModeTransition: () => Promise<void>;
  toggleMute: () => void;
  toggleTimer: () => void;
  setShotInputMode: (mode: ShotInputMode) => void;
  recordShotResult: (
    result: ShotResult,
    source: ShotEventSource,
    eventId: string,
  ) => Promise<ShotEventRecordOutcome>;
}

export function useCoach(
  dayId: string | null,
  initialShotInputMode: ShotInputMode = "voice",
  connectionEnabled: boolean | Partial<Record<ShotInputMode, boolean>> = true,
): UseCoachResult {
  const connectionAllowedFor = (
    value: boolean | Partial<Record<ShotInputMode, boolean>>,
    mode: ShotInputMode,
  ) => typeof value === "boolean" ? value : value[mode] !== false;
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
    previousRemaining: number | null;
    fired: Set<"seventy_five" | "halfway" | "twenty_five" | "ten_seconds">;
  }>({ runId: 0, previousRemaining: null, fired: new Set() });
  const timedSetPrefetchRef = useRef<{
    dayId: string;
    exerciseId: string;
    setNumber: number;
    promise: ReturnType<typeof prepareTimedExerciseSetCompletion>;
  } | null>(null);
  const conversationSummaryRef = useRef("");
  const conversationDayIdRef = useRef<string | null>(null);
  const connectingRef = useRef(false);
  const connectionIntentRef = useRef(0);
  const liveAudioEnabledRef = useRef(
    connectionAllowedFor(connectionEnabled, initialShotInputMode) &&
      initialShotInputMode !== "video",
  );
  const connectionEnabledRef = useRef(connectionEnabled);
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
  const shotInputModeRef = useRef<ShotInputMode>(initialShotInputMode);

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
  const [sttProvider, setSttProvider] = useState<CoachSttProvider | null>(null);
  const [providerFallbackReason, setProviderFallbackReason] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState({ microphone: 0, tts: 0 });
  const [muted, setMuted] = useState(false);
  const [shotInputMode, setShotInputModeState] =
    useState<ShotInputMode>(initialShotInputMode);
  const [videoHudState, setVideoHudState] =
    useState<VideoCoachHudState | null>(null);
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
        const encouragementState = timerEncouragementRef.current;
        if (encouragementState.runId !== timerRunIdRef.current) {
          encouragementState.runId = timerRunIdRef.current;
          encouragementState.previousRemaining = durationSeconds;
          encouragementState.fired = new Set();
        }
        const previousRemaining = encouragementState.previousRemaining ?? durationSeconds;
        const crossed = (threshold: number) =>
          previousRemaining > threshold && remaining <= threshold;
        // Ten seconds wins whenever it coincides with a percentage milestone.
        // This can occur for short timer durations (for example, 40 seconds).
        const marker = remaining > 0 && crossed(10) && !encouragementState.fired.has("ten_seconds")
          ? "ten_seconds"
          : remaining > 0 && crossed(durationSeconds * 0.25) &&
              !encouragementState.fired.has("twenty_five")
            ? "twenty_five"
            : remaining > 0 && crossed(durationSeconds * 0.5) &&
                !encouragementState.fired.has("halfway")
              ? "halfway"
              : remaining > 0 && crossed(durationSeconds * 0.75) &&
                  !encouragementState.fired.has("seventy_five")
                ? "seventy_five"
                : null;
        if (marker && sessionRef.current?.announceTimerMilestone(remaining)) {
          encouragementState.fired.add(marker);
        }
        encouragementState.previousRemaining = remaining;
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
        previousRemaining: null,
        fired: new Set(),
      };
      timerAudio.stopAll();
    } else if (action.type === "start_timer") {
      timerRunIdRef.current += 1;
      timerEncouragementRef.current = {
        runId: timerRunIdRef.current,
        previousRemaining: action.duration_seconds ?? null,
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
      sessionRef.current.setShotInputMode(shotInputModeRef.current);
    }
    return sessionRef.current;
  }, []);

  const setShotInputMode = useCallback((mode: ShotInputMode) => {
    if (mode === "video") liveAudioEnabledRef.current = false;
    shotInputModeRef.current = mode;
    sessionRef.current?.setShotInputMode(mode);
    setShotInputModeState(mode);
    setVideoHudState(
      mode === "video"
        ? sessionRef.current?.getVideoCoachHudState() ?? null
        : null,
    );
  }, []);

  const recordShotResult = useCallback(
    async (
      result: ShotResult,
      source: ShotEventSource,
      eventId: string,
    ): Promise<ShotEventRecordOutcome> => {
      const session = sessionRef.current;
      if (!session) {
        return Promise.resolve({
          status: "rejected",
          reason: "session_inactive",
        });
      }
      const outcome = await session.recordShotResult(result, source, eventId);
      if (shotInputModeRef.current === "video") {
        setVideoHudState(session.getVideoCoachHudState());
      }
      return outcome;
    },
    [],
  );

  useEffect(() => {
    if (shotInputMode !== "video") return;
    const refresh = () => {
      const session = sessionRef.current;
      if (session) setVideoHudState(session.getVideoCoachHudState());
    };
    refresh();
    const interval = setInterval(refresh, 500);
    return () => clearInterval(interval);
  }, [shotInputMode]);

  const startSession = useCallback(async () => {
    if (
      !connectionAllowedFor(
        connectionEnabledRef.current,
        shotInputModeRef.current,
      ) ||
      !dayId ||
      !overlayOpenRef.current ||
      limitBlockedRef.current
    ) {
      return;
    }
    if (connectingRef.current) return;

    connectingRef.current = true;
    liveAudioEnabledRef.current = true;
    const intent = connectionIntentRef.current;
    const ownsConnection = () =>
      connectionIntentRef.current === intent &&
      overlayOpenRef.current &&
      !limitBlockedRef.current;

    setStatus("connecting");
    try {
      const budget = await resolveWithin(
        refreshDailyBudget(),
        STARTUP_BUDGET_TIMEOUT_MS,
        dailyBudget,
      );
      if (!ownsConnection() || budget?.exhausted) return;

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
    setSttProvider(null);
    setProviderFallbackReason(null);

    await teardownRef.current;
    if (!ownsConnection() || !dayId) return;
    if (!conversationSummaryRef.current) {
      const savedConversation = await AsyncStorage.getItem(
        coachConversationKey(dayId),
      ).catch(() => null);
      if (
        savedConversation &&
        ownsConnection() &&
        conversationDayIdRef.current === dayId
      ) {
        conversationSummaryRef.current = savedConversation.slice(-1_200);
      }
    }
    if (!ownsConnection()) return;
    const session = ensureSession();
      await session.connect(
        dayId,
        getTimerState(),
        conversationSummaryRef.current,
        {
          onStatus: (next) => {
            if (!mountedRef.current || !ownsConnection()) return;
            setStatus(next);
          },
          onError: (msg) => {
            if (!mountedRef.current || !ownsConnection()) return;
            if (isCoachLimitMessage(msg)) {
              markLimitReached(msg);
              return;
            }
            setStatus("error");
            setError(msg);
          },
          onTimerAction: applyTimerAction,
          getTimerState,
          onAudioLevel: (source, level) => {
            if (!mountedRef.current || !ownsConnection()) return;
            setAudioLevels((current) => ({ ...current, [source]: level }));
          },
          onUserTranscript: (text) => {
            if (!mountedRef.current || !ownsConnection()) return;
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
          onCoachTranscript: (text, mode = "stream") => {
            if (!mountedRef.current || !ownsConnection()) return;
            transcriptGenerationRef.current += 1;
            if (coachTranscriptTimerRef.current) clearTimeout(coachTranscriptTimerRef.current);
            setCoachTranscriptFadeVersion(0);
            if (mode === "replace") {
              if (coachTypingTimerRef.current) {
                clearTimeout(coachTypingTimerRef.current);
                coachTypingTimerRef.current = null;
              }
              coachTranscriptShownWordCountRef.current = 0;
              setCoachTranscript("");
            }
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
            if (!mountedRef.current || !ownsConnection()) return;
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
            if (!mountedRef.current || !ownsConnection()) return;
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
            if (
              !mountedRef.current ||
              !overlayOpenRef.current ||
              !liveAudioEnabledRef.current ||
              !ownsConnection()
            ) return;
            if (
              reason === "daily_budget" ||
              reason === "response_limit"
            ) {
              return;
            }
            if (reason === "connection_lost" || reason === "connect_failed") {
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
            if (mountedRef.current && ownsConnection()) setConnectedProvider(provider);
          },
          onSttProviderConnected: (provider) => {
            if (mountedRef.current && ownsConnection()) setSttProvider(provider);
          },
          onConnectionEstablished: () => {
            if (!mountedRef.current || !ownsConnection()) return;
            // Socket readiness can precede the first TTS audio on a weak
            // network. Reset retries only after greeting playback proves the
            // whole voice path is usable; otherwise every failed startup
            // would reset the counter and reconnect forever.
            reconnectAttemptsRef.current = 0;
            setError(null);
          },
          onProviderFallback: (reason) => {
            if (mountedRef.current && ownsConnection()) setProviderFallbackReason(reason);
          },
        },
        {
          dailySpentUsd: budget?.spentUsd ?? dailySpentBaselineRef.current,
          dailyBudgetUsd: budget?.budgetUsd,
        }
      );
      if (!ownsConnection()) {
        await session.disconnect("mode_transition");
        return;
      }
      if (muted) session.mute();
    } catch {
      // onError already surfaced the message.
    } finally {
      if (connectionIntentRef.current === intent) {
        connectingRef.current = false;
      }
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

  useEffect(() => {
    connectionEnabledRef.current = connectionEnabled;
    if (!connectionAllowedFor(connectionEnabled, shotInputModeRef.current)) {
      liveAudioEnabledRef.current = false;
      return;
    }
    if (
      dayId &&
      overlayOpenRef.current &&
      shotInputModeRef.current !== "video" &&
      !limitBlockedRef.current
    ) {
      void startSessionRef.current();
    }
  }, [connectionEnabled, dayId]);

  const stopSession = useCallback(async () => {
    overlayOpenRef.current = false;
    liveAudioEnabledRef.current = false;
    connectionIntentRef.current += 1;
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

  // Video Coach waits for UIKit to finish rotating before it reconnects. Keep
  // the durable workout and conversation state, but stop live mic/TTS work.
  const suspendSessionForModeTransition = useCallback(async () => {
    liveAudioEnabledRef.current = false;
    connectionIntentRef.current += 1;
    connectingRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    teardownRef.current =
      session?.disconnect("mode_transition") ?? Promise.resolve();
    await teardownRef.current;
    if (mountedRef.current && overlayOpenRef.current) {
      setStatus("idle");
      setConnectedProvider(null);
      setSttProvider(null);
    }
  }, []);

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
    liveAudioEnabledRef.current =
      shotInputModeRef.current !== "video" &&
      connectionAllowedFor(connectionEnabledRef.current, shotInputModeRef.current);
    // Video Coach waits to create the live audio connection until the phone is
    // in landscape and its camera can be configured safely.
    if (
      shotInputModeRef.current !== "video" &&
      connectionAllowedFor(connectionEnabledRef.current, shotInputModeRef.current)
    ) {
      void startSessionRef.current();
    }

    return () => {
      overlayOpenRef.current = false;
      liveAudioEnabledRef.current = false;
      connectionIntentRef.current += 1;
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
        connectionIntentRef.current += 1;
        connectingRef.current = false;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
        const session = sessionRef.current;
        sessionRef.current = null;
        teardownRef.current = session?.disconnect("background") ?? Promise.resolve();
        return;
      }
      if (
        next === "active" &&
        dayId &&
        overlayOpenRef.current &&
        liveAudioEnabledRef.current &&
        !limitBlockedRef.current
      ) {
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
    sttProvider,
    providerFallbackReason,
    audioLevels,
    shotInputMode,
    videoHudState,
    startSession,
    stopSession,
    suspendSessionForModeTransition,
    toggleMute,
    toggleTimer,
    setShotInputMode,
    recordShotResult,
  };
};
