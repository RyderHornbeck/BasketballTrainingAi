// Voice coach session hook.
//
// Hands-free voice loop for one workout session:
//   mic opens -> voice activity detection watches audio levels -> user talks
//   -> ~1.2s of silence auto-sends the clip to the `coach` Edge Function
//   (STT + GPT tools + ElevenLabs TTS) -> reply plays -> mic re-opens.
//
// VAD is built on expo-audio's recording metering (dBFS). An adaptive noise
// floor handles loud environments like gyms: speech is a sustained jump
// above ambient, so single ball bounces don't trigger it.
//
// Also owns the workout timer (start/pause/resume via coach tool calls) and
// the in-memory conversation history so the model never loses context.

import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { supabase } from "@/lib/supabase";
import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CoachStatus = "idle" | "listening" | "recording" | "thinking" | "speaking";

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}

interface CoachResponse {
  transcript: string;
  reply: string | null;
  audio_base64: string | null;
  actions: Array<{ type: "start_timer" | "pause_timer" | "resume_timer" }>;
  db_changed: boolean;
  error?: string;
}

export interface UseCoachResult {
  status: CoachStatus;
  messages: CoachMessage[];
  error: string | null;
  timerRunning: boolean;
  elapsedSeconds: number;
  /** Open the mic and start the hands-free loop. Interrupts coach speech. */
  startListening: () => Promise<void>;
  /** Mute: close the mic and stop the hands-free loop. */
  stopListening: () => Promise<void>;
  /** Send whatever has been captured right now (manual override). */
  sendNow: () => Promise<void>;
  /** Stop any speech playback without reopening the mic. */
  stopSpeaking: () => void;
  toggleTimer: () => void;
  resetSession: () => void;
}

// --- VAD tuning -------------------------------------------------------------
const VAD_POLL_MS = 120;
/** Speech starts after this many consecutive frames above threshold (~240ms). */
const SPEECH_START_FRAMES = 2;
/** Speech ends after this much continuous silence. */
const SILENCE_END_MS = 1200;
/** Hard cap on one utterance so a noisy gym can't record forever. */
const MAX_UTTERANCE_MS = 30000;
/** Restart an idle (no speech) recording so files never grow unbounded. */
const IDLE_RESTART_MS = 15000;

interface VadState {
  noiseFloor: number;
  speechFrames: number;
  silenceMs: number;
  speaking: boolean;
  startedAt: number;
}

function freshVad(): VadState {
  return { noiseFloor: -55, speechFrames: 0, silenceMs: 0, speaking: false, startedAt: Date.now() };
}

export function useCoach(dayId: string | null): UseCoachResult {
  const recordingOptions = useMemo(
    () => ({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }),
    []
  );
  const recorder = useAudioRecorder(recordingOptions);

  const [status, setStatusState] = useState<CoachStatus>("idle");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const statusRef = useRef<CoachStatus>("idle");
  const playerRef = useRef<AudioPlayer | null>(null);
  const messagesRef = useRef<CoachMessage[]>([]);
  const timerRef = useRef({ running: false, accumulated: 0, startedAt: 0 });
  const requestSeq = useRef(0);

  const handsFreeRef = useRef(false);
  const vadRef = useRef<VadState>(freshVad());
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Function refs break the circular dependency between the VAD loop,
  // sendNow, and playback-finished -> resume listening.
  const sendNowRef = useRef<() => Promise<void>>(async () => {});
  const beginListeningRef = useRef<() => Promise<void>>(async () => {});

  const setStatus = useCallback((next: CoachStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // --- timer ----------------------------------------------------------------

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

  const setTimer = useCallback((action: "start_timer" | "pause_timer" | "resume_timer") => {
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
  }, []);

  const toggleTimer = useCallback(() => {
    setTimer(timerRef.current.running ? "pause_timer" : "start_timer");
  }, [setTimer]);

  // --- playback ---------------------------------------------------------------

  const destroyPlayer = useCallback(() => {
    const player = playerRef.current;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch {
        // Player may already be released.
      }
      playerRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    destroyPlayer();
    if (statusRef.current === "speaking") setStatus("idle");
  }, [destroyPlayer, setStatus]);

  // --- recording + VAD --------------------------------------------------------

  const clearVadTimer = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  const stopRecorderQuietly = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      // Already stopped.
    }
  }, [recorder]);

  /**
   * One VAD frame. Adaptive noise floor: quiet frames pull it toward ambient
   * level, and the speech threshold floats ~10dB above it (never below
   * -50 dBFS so breathing/rustle doesn't count as speech).
   */
  const vadTick = useCallback(() => {
    let meteringValue: number | undefined;
    let durationMs = 0;
    try {
      const recorderState = recorder.getStatus();
      if (!recorderState.isRecording) return;
      meteringValue = recorderState.metering;
      durationMs = recorderState.durationMillis ?? 0;
    } catch {
      return;
    }

    // Metering unavailable (some Android devices): stay open, manual send only.
    if (typeof meteringValue !== "number") return;

    const vad = vadRef.current;

    if (!vad.speaking) {
      if (meteringValue < vad.noiseFloor + 6) {
        vad.noiseFloor = vad.noiseFloor * 0.95 + meteringValue * 0.05;
      }
      const startThreshold = Math.max(vad.noiseFloor + 10, -50);
      if (meteringValue > startThreshold) {
        vad.speechFrames += 1;
        if (vad.speechFrames >= SPEECH_START_FRAMES) {
          vad.speaking = true;
          vad.silenceMs = 0;
          setStatus("recording");
        }
      } else {
        vad.speechFrames = 0;
        // Nothing said for a while: restart so the file stays small.
        if (Date.now() - vad.startedAt > IDLE_RESTART_MS) {
          clearVadTimer();
          stopRecorderQuietly().then(() => {
            if (handsFreeRef.current) beginListeningRef.current();
          });
        }
      }
    } else {
      const endThreshold = Math.max(vad.noiseFloor + 8, -52);
      if (meteringValue < endThreshold) {
        vad.silenceMs += VAD_POLL_MS;
      } else {
        vad.silenceMs = 0;
      }
      if (vad.silenceMs >= SILENCE_END_MS || durationMs > MAX_UTTERANCE_MS) {
        clearVadTimer();
        sendNowRef.current();
      }
    }
  }, [recorder, setStatus, clearVadTimer, stopRecorderQuietly]);

  /** Open the mic and arm the VAD loop. Assumes permission already granted. */
  const beginListening = useCallback(async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      vadRef.current = freshVad();
      setStatus("listening");
      clearVadTimer();
      vadTimerRef.current = setInterval(vadTick, VAD_POLL_MS);
    } catch (err) {
      console.error("Failed to open microphone:", err);
      setError("Couldn't start the microphone. Tap the mic to retry.");
      setStatus("idle");
      handsFreeRef.current = false;
    }
  }, [recorder, setStatus, clearVadTimer, vadTick]);

  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  const startListening = useCallback(async () => {
    setError(null);

    // The user wants to talk: kill any coach speech immediately.
    destroyPlayer();
    requestSeq.current += 1;

    if (statusRef.current === "listening" || statusRef.current === "recording") return;

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone access is required to talk to your coach.");
      setStatus("idle");
      return;
    }

    handsFreeRef.current = true;
    await beginListening();
  }, [destroyPlayer, beginListening, setStatus]);

  const stopListening = useCallback(async () => {
    handsFreeRef.current = false;
    clearVadTimer();
    requestSeq.current += 1;
    await stopRecorderQuietly();
    if (statusRef.current === "listening" || statusRef.current === "recording") {
      setStatus("idle");
    }
  }, [clearVadTimer, stopRecorderQuietly, setStatus]);

  // --- send + reply -----------------------------------------------------------

  const playReply = useCallback(
    async (audioBase64: string, seq: number) => {
      // Route playback through the normal iOS output (AirPods when connected,
      // otherwise the speaker) by leaving record mode.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});

      const uri = `${FileSystem.cacheDirectory}coach-reply-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (requestSeq.current !== seq) return; // interrupted while writing

      destroyPlayer();
      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      setStatus("speaking");

      player.addListener("playbackStatusUpdate", (playbackStatus) => {
        if (playbackStatus.didJustFinish) {
          destroyPlayer();
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          // Hands-free loop: the coach finished talking, reopen the mic.
          if (handsFreeRef.current && requestSeq.current === seq) {
            beginListeningRef.current();
          } else if (statusRef.current === "speaking") {
            setStatus("idle");
          }
        }
      });
      player.play();
    },
    [destroyPlayer, setStatus]
  );

  const sendNow = useCallback(async () => {
    if (statusRef.current === "thinking") return;
    clearVadTimer();

    if (!dayId) {
      setError("No active workout day.");
      await stopRecorderQuietly();
      setStatus("idle");
      return;
    }

    const spoke = vadRef.current.speaking;
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (err) {
      console.error("Failed to stop recording:", err);
    }

    // Nothing was actually said (auto-restart or manual send during silence):
    // don't waste a round trip, just reopen the mic.
    if (!uri || (!spoke && vadRef.current.speechFrames === 0)) {
      if (handsFreeRef.current) {
        await beginListening();
      } else {
        setStatus("idle");
      }
      return;
    }

    setStatus("thinking");
    const seq = ++requestSeq.current;

    try {
      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { data, error: invokeError } = await supabase.functions.invoke<CoachResponse>("coach", {
        body: {
          day_id: dayId,
          audio_base64: audioBase64,
          audio_mime: "audio/mp4",
          conversation: messagesRef.current.slice(-16),
          timer: {
            running: timerRef.current.running,
            elapsed_seconds: currentElapsed(),
          },
        },
      });

      if (invokeError) throw new Error(invokeError.message);
      if (!data) throw new Error("Empty response from coach.");
      if (data.error) throw new Error(data.error);

      // The user may have interrupted/muted while this was in flight.
      if (requestSeq.current !== seq) return;

      if (!data.transcript) {
        if (handsFreeRef.current) await beginListening();
        else setStatus("idle");
        return;
      }

      const next: CoachMessage[] = [
        ...messagesRef.current,
        { role: "user", content: data.transcript },
        ...(data.reply ? [{ role: "assistant" as const, content: data.reply }] : []),
      ];
      messagesRef.current = next;
      setMessages(next);

      for (const action of data.actions ?? []) {
        setTimer(action.type);
      }
      if (data.db_changed) {
        emitWorkoutUpdated();
      }

      if (data.audio_base64) {
        await playReply(data.audio_base64, seq);
      } else if (handsFreeRef.current) {
        await beginListening();
      } else {
        setStatus("idle");
      }
    } catch (err) {
      console.error("Coach request failed:", err);
      if (requestSeq.current === seq) {
        setError(
          err instanceof Error && /network/i.test(err.message)
            ? "Network hiccup — say that again."
            : "Coach didn't catch that. Say it again."
        );
        // Recover the loop instead of going dead after a bad request.
        if (handsFreeRef.current) await beginListening();
        else setStatus("idle");
      }
    } finally {
      if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }, [
    dayId,
    recorder,
    clearVadTimer,
    stopRecorderQuietly,
    beginListening,
    currentElapsed,
    setTimer,
    playReply,
    setStatus,
  ]);

  useEffect(() => {
    sendNowRef.current = sendNow;
  }, [sendNow]);

  const resetSession = useCallback(() => {
    handsFreeRef.current = false;
    clearVadTimer();
    destroyPlayer();
    requestSeq.current += 1;
    messagesRef.current = [];
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, [clearVadTimer, destroyPlayer, setStatus]);

  // Clean up the loop and playback when the hook unmounts.
  useEffect(() => {
    return () => {
      handsFreeRef.current = false;
      clearVadTimer();
      destroyPlayer();
    };
  }, [clearVadTimer, destroyPlayer]);

  return {
    status,
    messages,
    error,
    timerRunning,
    elapsedSeconds,
    startListening,
    stopListening,
    sendNow,
    stopSpeaking,
    toggleTimer,
    resetSession,
  };
}
