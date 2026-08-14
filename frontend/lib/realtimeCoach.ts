// Provider-neutral always-on coach coordinator. Cartesia is the default voice
// transport; OpenAI Realtime remains behind an explicit rollback flag.

import { emitWorkoutUpdated } from "@/lib/coachEvents";
import {
  appendConversationSummary,
  appendConversationTurn,
  COACH_LIMIT_MESSAGES,
  createClientRequestId,
  createSessionKey,
  createUsageTracker,
  isCoachLimitMessage,
  logCoachUsage,
} from "@/lib/coachUsage";
import {
  createProviderUsageDelta,
  type ProviderUsageDelta,
} from "@/lib/providerUsage";
import { supabase } from "@/lib/supabase";
import { isLikelyNetworkError, reportNetworkFailure } from "@/lib/connectivity";
import {
  parseCoachSpeechIntent,
  parseSpeechControlIntent,
  normalizeCoachSpeech,
  type CoachSpeechIntent,
  type NavigationTarget,
} from "@/lib/coachSpeech";
import { mergeShotProgress, parseSpokenShotCount } from "@/lib/shotSpeech";
import {
  parseShotProgressReply,
  playShotProgressAudio,
} from "@/lib/shotProgressAudio";
import { getCoachPersonaId } from "@/lib/coachProfiles";
import {
  CartesiaInkClient,
  CartesiaSonicClient,
  buildInkKeyterms,
  classifyPlaybackTranscript,
  gateCoachSpeechText,
  isLikelyPlaybackEcho,
  isSafeSpeculativeTranscript,
  shouldAcceptPlaybackChunk,
  shouldAcceptTurnEvent,
  shouldPromoteSpeculation,
  drainSonicTextChunks,
  type CartesiaSonicContext,
  type InkTranscriptEvent,
} from "@/lib/cartesia";

import {
  AssemblyRealtimeClient,
  INITIAL_FIRST_AUDIO_TIMEOUT_MS,
  InworldTtsClient,
  RETRY_FIRST_AUDIO_TIMEOUT_MS,
  type InworldRequestIdentity,
} from "@/lib/assemblyInworld";
import {
  type CoachVoiceProvider,
} from "@/lib/coachVoiceProvider";
import {
  streamCoachTurn,
  type CoachTurnStreamEvent,
} from "@/lib/coachTurnStream";
import {
  inferVoiceAudioProfile,
  startVoiceCallAudio,
  stopVoiceCallAudio,
} from "@/lib/webrtcAudio";

function isLikelyTimerStatusQuestion(transcript: string): boolean {
  const text = normalizeCoachSpeech(transcript);
  return (
    /\b(?:timer|countdown|clock)\b/.test(text) &&
    /\b(?:time|left|remaining|status|at)\b/.test(text)
  ) || /^(?:how much|how long)(?: more)? time\b/.test(text);
}

// Ink-2 has no free-form transcription prompt. Keyterms are its documented
// connection-level accuracy control; keep this focused vocabulary below
// Cartesia's 100-term / 1,200-character limit.
export const COACH_INK_KEYTERMS = [
  "Court Coach",
  "ball handling",
  "form shooting",
  "mid-range",
  "three-point",
  "free throw",
  "finishing",
  "layup",
  "dribbling",
  "crossover",
  "behind the back",
  "between the legs",
  "pound dribble",
  "V dribble",
  "Curry slide",
  "hesitation",
  "euro step",
  "floater",
  "make",
  "made",
  "miss",
  "missed",
  "yes",
  "no",
  "yeah",
  "yep",
  "nah",
  "nope",
  "okay",
  "sure",
  "coach",
  "hey coach",
  "what's next",
  "what is next",
  "next",
  "again",
  "this",
  "that",
  "current",
  "another",
  "done",
  "brick",
  "airball",
  "swish",
  "timer",
  "countdown",
  "seconds",
  "minutes",
  "start",
  "pause",
  "resume",
  "stop",
  "skip",
  "reopen",
  "set",
  "drill",
  "workout",
  "attempts",
  "targets",
  "percentage",
  "right side",
  "left side",
] as const;

async function edgeFunctionErrorMessage(error: {
  message: string;
  context?: Response;
}): Promise<string> {
  try {
    const res = error.context;
    if (res) {
      const body = (await res.json()) as {
        error?: string;
        detail?: string;
        code?: string;
      };
      if (body.code === "daily_budget_exhausted") {
        return COACH_LIMIT_MESSAGES.dailyBudgetExhausted;
      }
      if (body.detail) return `${body.error ?? error.message}: ${body.detail}`;
      if (body.error) return body.error;
    }
  } catch {
    // Fall back to generic invoke error.
  }
  return error.message;
}

export type RealtimeCoachStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "budget_exhausted"
  | "disconnecting"
  | "error";

export interface TimerState {
  running: boolean;
  elapsed_seconds: number;
  duration_seconds?: number | null;
  remaining_seconds?: number | null;
}

export interface ClientTimerAction {
  type: "start_timer" | "pause_timer" | "resume_timer" | "stop_timer" | "get_timer_status";
  duration_seconds?: number | null;
  timer_exercise_id?: string | null;
  timer_set_number?: number | null;
}

export interface RealtimeCoachCallbacks {
  onStatus: (status: RealtimeCoachStatus) => void;
  onError: (message: string) => void;
  getTimerState?: () => TimerState;
  onTimerAction: (action: ClientTimerAction) => void;
  onCommandHeard?: (event: RecognizedCoachCommand) => void;
  onUserTranscript?: (text: string) => void;
  onCoachTranscript?: (text: string) => void;
  onCoachPlaybackFinished?: () => void;
  onConversationSummary?: (summary: string) => void;
  onUsage?: (totals: ReturnType<ReturnType<typeof createUsageTracker>["snapshot"]>) => void;
  onBudgetUpdate?: (spentUsd: number, budgetUsd: number) => void;
  onSessionEnded?: (reason: string) => void;
  onProviderConnected?: (provider: CoachVoiceProvider) => void;
  onProviderFallback?: (reason: string) => void;
}

export interface RecognizedCoachCommand {
  turnId: string;
  label: string;
  state: "recognized" | "failed";
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

interface QueuedCoachResponse {
  instructions: string | null;
  outOfBand: boolean;
  itemId: string | null;
  sourceTranscript: string | null;
  speechEpoch: number;
}

interface RoutedCoachTurn {
  itemId: string;
  transcript: string;
  requestId: string;
  speechEpoch: number;
  eagerEndAt: number | null;
  speechStoppedAt: number | null;
  transcriptCompletedAt: number;
  routeDecidedAt: number | null;
  providerFirstDeltaAt: number | null;
  sonicFirstTextAt: number | null;
  sonicFirstAudioAt: number | null;
  playbackFirstEnqueueAt: number | null;
  backendCompletedAt: number | null;
}

interface InworldSpeech {
  turnId: string;
  speechEpoch: number;
  contextId: string;
  text: string;
  final: boolean;
  retried: boolean;
  firstAudioReceived: boolean;
}

interface SpeculativeCoachTurn {
  inkRequestId: string;
  turnId: string;
  transcript: string;
  normalizedTranscript: string;
  speechEpoch: number;
  stateVersion: number;
  eagerEndAt: number;
  controller: AbortController;
  events: CoachTurnStreamEvent[];
  responseText: string;
  promoted: boolean;
  routedTurn: RoutedCoachTurn | null;
  promise: Promise<void>;
  error: unknown;
}

interface PendingTimerDurationChange {
  exerciseId: string;
  drillName: string | null;
  setNumber: number;
  prescribedSeconds: number;
  requestedSeconds: number;
  startAfterConfirmation?: boolean;
  restartAfterConfirmation?: boolean;
}

interface TtsDiagnosticEvent {
  event_type: string;
  provider_request_id: string | null;
  details: Record<string, unknown>;
}

interface PendingIncompleteShotCompletion {
  exerciseId: string;
  drillName: string | null;
  setNumber: number;
}

interface PendingIncompleteSetContinuation {
  drillName: string | null;
  setNumber: number;
}

interface RealtimeSetResult {
  set_number: number;
  makes: number | null;
  attempts: number | null;
  completed: boolean;
  side_label?: string | null;
  progress?: { makes: number; attempts: number; misses: number };
  target?: { makes: number | null; attempts: number | null; minutes?: number | null };
  remaining?: { makes: number | null; attempts: number | null };
}

interface RealtimeDrillState {
  drill_position?: number;
  exercise_id: string;
  name: string | null;
  category?: string | null;
  status?: "complete" | "in_progress" | "not_started";
  target: {
    makes: number | null;
    attempts: number | null;
    minutes?: number | null;
  };
  sets: {
    total?: number;
    completed?: number;
    next_unfinished: number | null;
  };
  logged_totals?: {
    makes: number | null;
    attempts: number | null;
    misses: number | null;
  };
  log_type?: string | null;
  set_results: RealtimeSetResult[];
}

interface RealtimeCurrentSetState {
  exercise_id: string;
  drill_name: string | null;
  set_number: number;
  side_label?: string | null;
  completed: boolean;
  progress: { makes: number; attempts: number; misses: number };
  target: { makes: number | null; attempts: number | null; minutes?: number | null };
  remaining: { makes: number | null; attempts: number | null };
}

interface RealtimeWorkoutState {
  workout_day?: { title?: string | null; focus?: string | null };
  sequence?: { drills?: RealtimeDrillState[] };
  navigation?: {
    next_work_item?: (RealtimeDrillState & {
      set_number?: number | null;
      set_side_label?: string | null;
    }) | null;
    next_exercise_after_current?: RealtimeDrillState | null;
    current_set_state?: RealtimeCurrentSetState | null;
  };
  progress?: {
    completed_drills?: number;
    total_drills?: number;
    remaining_drills?: number;
    makes_today?: number;
    attempts_today?: number;
    shooting_pct?: number | null;
  };
}

interface PendingShotSet {
  exerciseId: string;
  drillName: string;
  setNumber: number;
  sideLabel: string | null;
  makes: number;
  attempts: number;
  targetMakes: number | null;
  targetAttempts: number | null;
  completed: boolean;
  requestId?: string;
}

interface NextSetGuidance {
  drillName: string;
  setNumber: number;
  sideLabel: string | null;
}

interface ShotUndoEntry {
  exerciseId: string;
  drillName: string;
  setNumber: number;
  makes: number;
  attempts: number;
}

type ToolExecutionKind = "read_only" | "mutation" | "buffered_shot" | "completed_shot";

interface CoachToolResponse {
  result: string;
  client_action: ClientTimerAction | null;
  db_changed: boolean;
  local_confirmation?: string | null;
  skip_model_response?: boolean;
  deduplicated?: boolean;
  updated_context?: string | null;
  client_workout_context?: string | null;
  updated_instructions?: string | null;
  tool_kind?: "read_only" | "mutation";
  requires_spoken_confirmation?: boolean;
  state_version?: number;
  error?: string;
}

const FLUSH_BEFORE_TOOLS = new Set([
  "set_current_position",
  "complete_drill",
  "set_set_completion",
  "set_shooting_set_targets",
  "add_workout_exercise",
  "remove_workout_exercise",
]);

const LOCAL_SHOT_TOOLS = new Set([
  "record_make",
  "record_miss",
  "record_makes",
  "record_misses",
  "add_shooting_result",
  "set_shooting_total",
  // Compatibility for a session created just before this update.
  "save_shooting_results",
]);
const DETERMINISTIC_SHOT_TOOLS = new Set([
  "record_make",
  "record_miss",
  "record_makes",
  "record_misses",
]);
function normalizeDrillReference(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MIC_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

async function loadWebRTC() {
  const mod = await import("react-native-webrtc");
  mod.registerGlobals();
  return mod;
}

type WebRTCModule = Awaited<ReturnType<typeof loadWebRTC>>;
type RnMediaStream = Awaited<ReturnType<WebRTCModule["mediaDevices"]["getUserMedia"]>>;
type DuplexAudioModule = typeof import("expo-duplex-audio");
type NativeEventSubscription = { remove(): void };

type PcmInputFrame = {
  data: string;
  frames: number;
  sampleRate: number;
};

/**
 * Keeps the microphone open locally, but sends Ink only likely speech plus
 * enough leading/trailing PCM for accurate first words and turn detection.
 * Cartesia bills submitted audio duration, including silence.
 */
class InkAudioGate {
  private readonly preRoll: PcmInputFrame[] = [];
  private preRollFrames = 0;
  private sending = false;
  private providerTurnActive = false;
  private trailingFrames = 0;
  private noiseFloor = 220;
  private consecutiveSpeechFrames = 0;

  accept(frame: PcmInputFrame): PcmInputFrame[] {
    const level = pcm16Rms(frame.data);
    const speechThreshold = Math.max(420, this.noiseFloor * 2.5);
    const isSpeech = level >= speechThreshold;
    if (!isSpeech) {
      // Learn the room noise only while idle; never let it grow quickly
      // enough to suppress an athlete who starts speaking over a loud gym.
      this.noiseFloor = this.noiseFloor * 0.985 + level * 0.015;
      this.consecutiveSpeechFrames = 0;
    } else {
      this.consecutiveSpeechFrames += 1;
    }

    if (!this.sending) {
      this.remember(frame);
      // Two 20 ms speech frames avoid opening on a single gym impact while
      // pre-roll retains those first 40 ms once actual speech is confirmed.
      if (!isSpeech || this.consecutiveSpeechFrames < 2) return [];
      this.sending = true;
      this.trailingFrames = Math.round(frame.sampleRate * 1.25);
      const buffered = this.preRoll.splice(0);
      this.preRollFrames = 0;
      return buffered;
    }

    // Once Ink has acknowledged the turn, it must receive continuous PCM
    // until its own turn.end event. Stopping the silent tail early leaves the
    // provider turn open and causes the next utterance to be appended to it.
    if (this.providerTurnActive) return [frame];

    if (isSpeech) {
      // Forward actual captured silence longer than Ink's 1.1 s timeout.
      // A WebSocket gap is not a dependable substitute for silent PCM.
      this.trailingFrames = Math.round(frame.sampleRate * 1.25);
    } else {
      this.trailingFrames -= frame.frames;
    }
    if (this.trailingFrames <= 0) {
      this.sending = false;
      this.trailingFrames = 0;
    }
    return [frame];
  }

  endTurn(): void {
    this.sending = false;
    this.providerTurnActive = false;
    this.trailingFrames = 0;
    this.consecutiveSpeechFrames = 0;
    this.preRoll.length = 0;
    this.preRollFrames = 0;
  }

  providerTurnStarted(): void {
    this.providerTurnActive = true;
  }

  private remember(frame: PcmInputFrame): void {
    this.preRoll.push(frame);
    this.preRollFrames += frame.frames;
    const maxFrames = Math.round(frame.sampleRate * 0.45);
    while (this.preRollFrames > maxFrames && this.preRoll.length > 1) {
      this.preRollFrames -= this.preRoll.shift()?.frames ?? 0;
    }
  }
}

function pcm16Rms(base64Pcm: string): number {
  if (typeof globalThis.atob !== "function") return Number.POSITIVE_INFINITY;
  const binary = globalThis.atob(base64Pcm);
  if (binary.length < 2) return 0;
  let squareSum = 0;
  const samples = Math.floor(binary.length / 2);
  for (let index = 0; index + 1 < binary.length; index += 2) {
    const value = (binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8));
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    squareSum += signed * signed;
  }
  return Math.sqrt(squareSum / samples);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  if (typeof globalThis.btoa !== "function") {
    throw new Error("Base64 encoding is unavailable.");
  }
  return globalThis.btoa(binary);
}

function waitForDataChannelOpen(dc: any): Promise<void> {
  if (dc.readyState === "open") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reportNetworkFailure("realtime-coach");
      reject(new Error("Coach data channel timed out."));
    }, 15000);
    const onOpen = () => {
      clearTimeout(timeout);
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      reportNetworkFailure("realtime-coach");
      clearTimeout(timeout);
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      reject(new Error("Coach data channel failed to open."));
    };
    dc.addEventListener("open", onOpen);
    dc.addEventListener("error", onError);
  });
}

export class RealtimeCoachSession {
  private pc: any = null;
  private dc: any = null;
  private localStream: RnMediaStream | null = null;
  private remoteStream: RnMediaStream | null = null;
  private callbacks: RealtimeCoachCallbacks | null = null;
  private dayId: string | null = null;
  private timer: TimerState = { running: false, elapsed_seconds: 0, duration_seconds: null };
  private conversationSummary = "";
  private sessionKey: string | null = null;
  private model = "gpt-realtime-2.1-mini";
  private active = false;
  private connecting = false;
  private muted = false;
  private playbackActive = false;
  private generationActive = false;
  private activeResponseId: string | null = null;
  private toolBusy = false;
  private responseCreatePending = false;
  private responseQueue: QueuedCoachResponse[] = [];
  private pendingResponseTranscript: string | null = null;
  private pendingResponseEpoch = 0;
  private responseTranscripts = new Map<string, string>();
  private responseEpochs = new Map<string, number>();
  private routedTurns = new Map<string, RoutedCoachTurn>();
  private speechStoppedAtByItem = new Map<string, number>();
  private deterministicTurnCount = 0;
  private fallbackTurnCount = 0;
  private pendingTimerDurationChange: PendingTimerDurationChange | null = null;
  private pendingIncompleteShotCompletion: PendingIncompleteShotCompletion | null = null;
  private pendingIncompleteSetContinuation: PendingIncompleteSetContinuation | null = null;
  private assemblyPartialFallback: {
    timer: ReturnType<typeof setTimeout>;
    transcript: string;
    generation: number;
  } | null = null;
  private lastAssemblyFallbackTranscript: { text: string; at: number } | null = null;
  private speechEpoch = 0;
  private inkTurnSequence = 0;
  private latestUserTranscript: string | null = null;
  private pendingEvents: Record<string, unknown>[] = [];
  private responseCreateTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectGraceTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private contextRefreshPromise: Promise<void> | null = null;
  private contextRefreshPending = false;
  private contextRefreshRequested = 0;
  private contextRefreshCompleted = 0;
  private externalWorkoutMutationPromise: Promise<void> | null = null;
  private responseDoneQueue: Promise<void> = Promise.resolve();
  private transcriptRouteQueue: Promise<void> = Promise.resolve();
  private connectionGeneration = 0;
  private dailySpentBaseline = 0;
  private dailyBudgetUsd = 0.85;
  private usageTracker: ReturnType<typeof createUsageTracker> | null = null;
  private handledToolCalls = new Set<string>();
  private loggedUsageSessionKeys = new Set<string>();
  private workoutState: RealtimeWorkoutState | null = null;
  private pendingShotSets = new Map<string, PendingShotSet>();
  private shotFlushPromise: Promise<void> | null = null;
  private exactBufferedShotReply: string | null = null;
  private exactCompletedShotReply: string | null = null;
  private stopLocalShotPlayback: (() => void) | null = null;
  private lastDeterministicReply: string | null = null;
  private cartesiaActive = false;
  private voiceProvider: CoachVoiceProvider = "cartesia";
  private assemblyInworldActive = false;
  private assemblyClient: AssemblyRealtimeClient | null = null;
  private inworldClient: InworldTtsClient | null = null;
  private inworldVoiceId = "";
  private voicePersona = "tyler";
  private inworldContextId: string | null = null;
  private inworldSpeech: InworldSpeech | null = null;
  private inworldTurnSequence = 0;
  private inworldRecoveryPromise: Promise<void> | null = null;
  private assemblySpeechStartDeferred = false;
  private assemblyEchoGuardUntil = 0;
  private assemblyLastServerActivityAt = 0;
  private assemblyHeartbeatWatchdog: ReturnType<typeof setInterval> | null = null;
  private inworldPlaybackStartWatchdog: ReturnType<typeof setTimeout> | null = null;
  private assemblyUsageReportingTimer: ReturnType<typeof setInterval> | null = null;
  private lastAssemblyCoachSpeech: string | null = null;
  private streamedCoachTranscript = "";
  private inkClient: CartesiaInkClient | null = null;
  private sonicClient: CartesiaSonicClient | null = null;
  private sonicContext: CartesiaSonicContext | null = null;
  private duplexAudio: DuplexAudioModule | null = null;
  private duplexSubscriptions: NativeEventSubscription[] = [];
  private inkAudioGate: InkAudioGate | null = null;
  private turnAbortController: AbortController | null = null;
  private stateVersion = 0;
  private stateFingerprint = "";
  private cartesiaVoiceId = "";
  private ttsInputBuffer = "";
  private ttsSafetyBlocked = false;
  private playbackEnqueue: Promise<void> = Promise.resolve();
  private replayableSonicSpeech:
    | { text: string; speechEpoch: number; retried: boolean }
    | null = null;
  private sonicAudioEnqueuedEpoch: number | null = null;
  private deferredBargeInRequestIds = new Set<string>();
  private playbackGeneration = 0;
  private speculativeTurn: SpeculativeCoachTurn | null = null;
  private inkReconnectPromise: Promise<void> | null = null;
  private sonicReconnectPromise: Promise<void> | null = null;
  private cartesiaSttSeconds = 0;
  private cartesiaTtsCharacters = 0;
  private assemblySessionStartedAt = 0;
  private inworldTtsCharacters = 0;
  private reportedAssemblySessionSeconds = 0;
  private reportedInworldTtsCharacters = 0;
  private reportedSttSeconds = 0;
  private reportedTtsCharacters = 0;
  private providerUsageSequence = 0;
  private providerUsagePromise: Promise<void> | null = null;
  private ttsDiagnosticEvents: TtsDiagnosticEvent[] = [];
  private ttsDiagnosticFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsDiagnosticFlushPromise: Promise<void> | null = null;
  private pendingCartesiaUsage: ProviderUsageDelta | null = null;
  private pendingAssemblyInworldUsage: ProviderUsageDelta | null = null;
  private shotUndoStack: ShotUndoEntry[] = [];

  getSessionKey(): string | null {
    return this.sessionKey;
  }

  async connect(
    dayId: string,
    timer: TimerState,
    conversationSummary: string,
    callbacks: RealtimeCoachCallbacks,
    options?: { dailySpentUsd?: number; dailyBudgetUsd?: number }
  ): Promise<void> {
    if (this.disconnectPromise) await this.disconnectPromise;
    if (this.connecting) return;
    if (this.active) return;
    if (this.pc) await this.disconnect("reconnect");

    const generation = ++this.connectionGeneration;
    this.connecting = true;
    this.callbacks = callbacks;
    this.dailySpentBaseline = options?.dailySpentUsd ?? 0;
    this.dailyBudgetUsd = options?.dailyBudgetUsd ?? 0.85;

    if (this.dailySpentBaseline >= this.dailyBudgetUsd) {
      this.connecting = false;
      this.callbacks.onError(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
      this.callbacks.onStatus("budget_exhausted");
      return;
    }
    this.active = true;
    this.dayId = dayId;
    this.timer = timer;
    this.conversationSummary = conversationSummary;
    this.sessionKey = createSessionKey();
    this.model = "gpt-realtime-2.1-mini";
    this.handledToolCalls.clear();
    this.pendingEvents = [];
    this.generationActive = false;
    this.playbackActive = false;
    this.activeResponseId = null;
    this.responseCreatePending = false;
    this.responseQueue = [];
    this.pendingResponseTranscript = null;
    this.responseTranscripts.clear();
    this.responseEpochs.clear();
    this.routedTurns.clear();
    this.speechStoppedAtByItem.clear();
    this.deterministicTurnCount = 0;
    this.fallbackTurnCount = 0;
    this.pendingTimerDurationChange = null;
    this.pendingIncompleteShotCompletion = null;
    this.pendingIncompleteSetContinuation = null;
    this.clearAssemblyPartialFallback();
    this.lastAssemblyFallbackTranscript = null;
    this.speechEpoch = 0;
    this.inkTurnSequence = 0;
    this.playbackGeneration = 0;
    this.speculativeTurn = null;
    this.inkReconnectPromise = null;
    this.sonicReconnectPromise = null;
    this.latestUserTranscript = null;
    this.contextRefreshPending = false;
    this.contextRefreshRequested = 0;
    this.contextRefreshCompleted = 0;
    this.externalWorkoutMutationPromise = null;
    this.exactBufferedShotReply = null;
    this.exactCompletedShotReply = null;
    this.stopLocalShotPlayback?.();
    this.stopLocalShotPlayback = null;
    this.stateVersion = 0;
    this.stateFingerprint = "";
    this.ttsInputBuffer = "";
    this.ttsSafetyBlocked = false;
    this.deferredBargeInRequestIds.clear();
    this.cartesiaSttSeconds = 0;
    this.cartesiaTtsCharacters = 0;
    this.assemblySessionStartedAt = 0;
    this.inworldTtsCharacters = 0;
    this.reportedAssemblySessionSeconds = 0;
    this.reportedInworldTtsCharacters = 0;
    this.reportedSttSeconds = 0;
    this.reportedTtsCharacters = 0;
    this.providerUsageSequence = 0;
    this.providerUsagePromise = null;
    this.pendingCartesiaUsage = null;
    this.pendingAssemblyInworldUsage = null;
    this.shotUndoStack = [];
    this.assemblySpeechStartDeferred = false;
    this.assemblyEchoGuardUntil = 0;
    this.lastAssemblyCoachSpeech = null;
    this.inworldSpeech = null;
    this.inworldTurnSequence = 0;
    this.inworldRecoveryPromise = null;
    this.usageTracker = createUsageTracker(this.model);
    callbacks.onStatus("connecting");

    try {
      // AssemblyAI + Inworld is the sole user-selectable voice route. The
      // Cartesia implementation remains only as a startup-failure fallback.
      this.voiceProvider = "assembly_inworld";
      if (this.voiceProvider === "assembly_inworld") {
        try {
        await this.connectAssemblyInworld(generation);
        } catch (assemblyError) {
          // The alternate route is an opt-in developer experiment. A failed
          // warm-up must not leave a user without the stable default route.
          console.warn("AssemblyAI/Inworld initialization failed; falling back to Cartesia.", assemblyError);
          this.assemblyClient?.close();
          this.inworldClient?.close();
          this.assemblyClient = null;
          this.inworldClient = null;
          for (const subscription of this.duplexSubscriptions) subscription.remove();
          this.duplexSubscriptions = [];
          await this.duplexAudio?.stopSessionAsync().catch(() => undefined);
          this.duplexAudio = null;
          this.inkAudioGate = null;
          this.assemblyInworldActive = false;
          this.voiceProvider = "cartesia";
          this.callbacks?.onProviderFallback?.(
            assemblyError instanceof Error
              ? assemblyError.message
              : "AssemblyAI/Inworld could not connect.",
          );
          await this.connectCartesia(generation);
        }
        if (generation === this.connectionGeneration && this.active) {
          this.callbacks?.onStatus(this.muted ? "muted" : "listening");
          this.callbacks?.onProviderConnected?.(this.voiceProvider);
        }
        return;
      }
      if (process.env.EXPO_PUBLIC_COACH_VOICE_TRANSPORT !== "openai_realtime") {
        await this.connectCartesia(generation);
        if (generation === this.connectionGeneration && this.active) {
          this.callbacks?.onStatus(this.muted ? "muted" : "listening");
          this.callbacks?.onProviderConnected?.("cartesia");
        }
        return;
      }
      let audioProfile = await startVoiceCallAudio();
      const webrtc = await loadWebRTC();
      const { mediaDevices, RTCPeerConnection, RTCSessionDescription } = webrtc;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
        bundlePolicy: "max-bundle",
      }) as any;
      this.pc = pc;

      const dc = pc.createDataChannel("oai-events") as any;
      this.dc = dc;
      dc.addEventListener("message", (e: { data?: string | ArrayBuffer }) => {
        if (generation === this.connectionGeneration && e.data != null) {
          this.handleDataChannelMessage(e.data);
        }
      });
      dc.addEventListener("close", () => {
        if (generation === this.connectionGeneration && this.active) {
          reportNetworkFailure("realtime-coach");
          void this.disconnect("connection_lost");
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        if (!this.active || generation !== this.connectionGeneration) return;
        const state = pc.connectionState;
        if (state === "connected") {
          if (this.disconnectGraceTimeout) clearTimeout(this.disconnectGraceTimeout);
          this.disconnectGraceTimeout = null;
          return;
        }
        if (state === "disconnected") {
          if (this.disconnectGraceTimeout) clearTimeout(this.disconnectGraceTimeout);
          this.disconnectGraceTimeout = setTimeout(() => {
            if (
              generation === this.connectionGeneration &&
              this.active &&
              this.pc?.connectionState === "disconnected"
            ) {
              reportNetworkFailure("realtime-coach");
              this.callbacks?.onError("Coach connection lost.");
              void this.disconnect("connection_lost");
            }
          }, 3_000);
          return;
        }
        if (state === "failed" || state === "closed") {
          reportNetworkFailure("realtime-coach");
          this.callbacks?.onError("Coach connection lost.");
          void this.disconnect("connection_lost");
        }
      });

      pc.addEventListener("track", (event: { streams?: RnMediaStream[]; track?: { enabled: boolean } }) => {
        const [stream] = event.streams ?? [];
        if (stream) this.remoteStream = stream;
        if (event.track) event.track.enabled = true;
      });

      const stream = await mediaDevices.getUserMedia({
        audio: MIC_CONSTRAINTS as Record<string, unknown>,
        video: false,
      });
      if (generation !== this.connectionGeneration || !this.active) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.localStream = stream;
      audioProfile = inferVoiceAudioProfile(stream.getAudioTracks(), audioProfile);
      for (const track of stream.getAudioTracks()) {
        // Prevent a user turn before the session instructions and workout state
        // are installed by the server.
        track.enabled = false;
        pc.addTrack(track, stream);
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      const { data, error } = await supabase.functions.invoke<{
        sdp: string;
        error?: string;
        code?: string;
        model?: string;
        voice?: string;
        session_key?: string;
        workout_context?: string;
        workout_usage?: {
          spent_usd: number;
          budget_usd: number;
          remaining_usd: number;
        };
        daily_usage?: {
          spent_usd: number;
          budget_usd: number;
          remaining_usd: number;
        };
      }>("coach-realtime", {
        body: {
          day_id: this.dayId,
          sdp: offer.sdp,
          timer,
          audio_profile: audioProfile,
          session_key: this.sessionKey,
          conversation_summary: this.conversationSummary,
        },
      });

      if (generation !== this.connectionGeneration || !this.active) return;
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data?.sdp) {
        if (data?.code === "daily_budget_exhausted") {
          throw new Error(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
        }
        throw new Error(data?.error ?? "No SDP answer from coach-realtime.");
      }

      if (data.daily_usage) {
        this.dailySpentBaseline = data.daily_usage.spent_usd;
        this.dailyBudgetUsd = data.daily_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(this.dailySpentBaseline, this.dailyBudgetUsd);
      }

      this.model = data.model ?? this.model;
      this.usageTracker = createUsageTracker(this.model);
      this.updateWorkoutState(data.workout_context);

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
      await waitForDataChannelOpen(dc);
      if (generation !== this.connectionGeneration || !this.active) return;

      this.flushPendingEvents();
      if (!this.muted) {
        for (const track of stream.getAudioTracks()) track.enabled = true;
      }

      this.callbacks?.onStatus("listening");
    } catch (err) {
      if (generation !== this.connectionGeneration) return;
      console.error("Realtime coach connect failed:", err);
      const msg = err instanceof Error ? err.message : "Failed to connect to coach.";
      if (isLikelyNetworkError(msg)) reportNetworkFailure("realtime-coach");
      this.callbacks?.onError(msg);
      if (isCoachLimitMessage(msg)) {
        this.callbacks?.onStatus("budget_exhausted");
      } else {
        this.callbacks?.onStatus("error");
      }
      await this.disconnect("connect_failed");
      // disconnect() performs cleanup and briefly reports "disconnecting".
      // Restore the meaningful terminal state so setup failures are visible
      // and retryable instead of looking like unexplained auto-disconnects.
      this.callbacks?.onStatus(
        isCoachLimitMessage(msg) ? "budget_exhausted" : "error"
      );
      throw err;
    } finally {
      if (generation === this.connectionGeneration) this.connecting = false;
    }
  }

  private async connectCartesia(generation: number): Promise<void> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) throw new Error("Coach session is not active.");
    const { data: profile } = await supabase
      .from("profiles")
      .select("realtime_coach_voice")
      .maybeSingle();
    const voicePersona = getCoachPersonaId(profile?.realtime_coach_voice);
    this.voicePersona = voicePersona;
    const { data, error } = await supabase.functions.invoke<{
      error?: string;
      code?: string;
      provider?: { access_token: string; expires_at: string };
      voice?: { provider_voice_id: string; model_id: string };
      workout_context?: string | RealtimeWorkoutState;
      state?: { version?: number };
      daily_usage?: {
        spent_usd: number;
        budget_usd: number;
        remaining_usd: number;
      };
    }>("coach-agent-session", {
      body: {
        day_id: dayId,
        session_key: sessionKey,
        voice_persona: voicePersona,
        state_version: this.stateVersion,
        timer: this.timer,
        conversation_summary: this.conversationSummary,
      },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (!data?.provider?.access_token || !data.voice?.provider_voice_id) {
      throw new Error(data?.error ?? "Voice provider session was not created.");
    }
    if (data.daily_usage) {
      this.dailySpentBaseline = data.daily_usage.spent_usd;
      this.dailyBudgetUsd = data.daily_usage.budget_usd;
      this.callbacks?.onBudgetUpdate?.(this.dailySpentBaseline, this.dailyBudgetUsd);
    }
    this.stateVersion = Math.max(this.stateVersion, data.state?.version ?? 0);
    this.cartesiaVoiceId = data.voice.provider_voice_id;
    this.updateWorkoutState(
      typeof data.workout_context === "string"
        ? data.workout_context
        : JSON.stringify(data.workout_context ?? null)
    );

    const duplexAudio = await import("expo-duplex-audio");
    const permission = await duplexAudio.requestPermissionsAsync();
    if (!permission.granted) throw new Error("Microphone permission is required for Coach.");
    await duplexAudio.startSessionAsync({
      sampleRate: 24000,
      frameDurationMs: 20,
      speaker: true,
      muted: this.muted,
    });
    if (generation !== this.connectionGeneration || !this.active) {
      await duplexAudio.stopSessionAsync();
      return;
    }
    this.duplexAudio = duplexAudio;

    const token = data.provider.access_token;
    const sonic = new CartesiaSonicClient({
      accessToken: token,
      onError: (providerError) => {
        if (generation !== this.connectionGeneration) return;
        console.error("Cartesia Sonic error:", providerError);
        // A Sonic context can report a provider error while the persistent
        // socket remains usable. Its context-level handler retries speech
        // before audio is queued, so surfacing this as a session failure
        // incorrectly flips the coach UI to "Tap to retry."
        if (!this.sonicClient?.isOpen) {
          void this.recoverCartesiaSocket("sonic", generation);
        }
      },
      onClose: () => {
        if (generation === this.connectionGeneration && this.active) {
          reportNetworkFailure("cartesia-sonic");
          void this.recoverCartesiaSocket("sonic", generation);
        }
      },
    });
    const logInkLifecycle = (
      stage: "start" | "eager_end" | "resume" | "end",
      requestId: string,
      transcript?: string,
    ) => {
      console.info("[coach_ink_turn]", {
        stage,
        request_id: requestId,
        transcript_characters: transcript?.trim().length ?? 0,
        speech_epoch: this.speechEpoch,
      });
    };
    const routeInkTurn = (event: InkTranscriptEvent) => {
      if (
        generation !== this.connectionGeneration ||
        !event.transcript.trim()
      ) {
        return;
      }
      const isDeferredBargeIn = this.deferredBargeInRequestIds.delete(
        event.requestId,
      );
      if (isDeferredBargeIn) {
        const control = this.parsePlaybackStopCommand(event.transcript);
        if (
          control &&
          !isLikelyPlaybackEcho(
            event.transcript,
            this.replayableSonicSpeech?.text,
          )
        ) {
          this.handleCartesiaSpeechStart(generation);
        }
        console.info("[coach_ink_turn]", {
          stage: control ? "local_stop_command" : "suppressed_playback_echo",
          request_id: event.requestId,
          transcript_characters: event.transcript.trim().length,
        });
        return;
      }
      logInkLifecycle("end", event.requestId, event.transcript);
      const turnSpeechEpoch = this.speechEpoch;
      const turnSequence = ++this.inkTurnSequence;
      const speculation = this.takeMatchingSpeculation(event, turnSpeechEpoch);
      this.transcriptRouteQueue = this.transcriptRouteQueue
        .then(() => {
          if (turnSpeechEpoch !== this.speechEpoch) return;
          return this.routeTranscribedTurn(
            event.transcript.trim(),
            `${event.requestId}:${turnSequence}`,
            generation,
            speculation,
          );
        })
        .catch((routeError) => {
          console.error("Failed to route Cartesia transcript:", routeError);
          if (
            generation === this.connectionGeneration &&
            this.active &&
            turnSpeechEpoch === this.speechEpoch
          ) {
            this.conversationSummary = appendConversationTurn(
              this.conversationSummary,
              event.transcript.trim(),
              "",
            );
            this.callbacks?.onConversationSummary?.(this.conversationSummary);
            this.callbacks?.onError(
              routeError instanceof Error
                ? routeError.message
                : "Coach request failed.",
            );
          }
        });
    };
    const ink = new CartesiaInkClient({
      accessToken: token,
      encoding: "pcm_s16le",
      sampleRate: 24000,
      keyterms: buildInkKeyterms(
        COACH_INK_KEYTERMS,
        this.orderedDrills()
          .map((drill) => drill.name ?? "")
          .filter(Boolean),
      ),
      turn: {
        startThreshold: 0.65,
        eagerEndThreshold: 0.4,
        endThreshold: 0.15,
        // Fast final transcripts without the previous 750 ms cutoff. Ink's
        // semantic end signal can finalize sooner; this is only its backstop.
        endTimeoutMs: 1100,
      },
      onTurnStart: (event) => {
        logInkLifecycle("start", event.requestId);
        this.inkAudioGate?.providerTurnStarted();
        if (
          this.playbackActive ||
          this.generationActive ||
          Date.now() < this.assemblyEchoGuardUntil
        ) {
          // Do not cut Coach off merely because its own output leaked into
          // the microphone. A real barge-in is accepted on final transcript.
          this.deferredBargeInRequestIds.add(event.requestId);
          return;
        }
        this.handleCartesiaSpeechStart(generation);
      },
      onTurnUpdate: (event) => {
        // While Coach speaks, partial ASR is never enough to interrupt.
        // Exact local stop commands are accepted only from a final turn.
        void event;
      },
      onTurnEagerEnd: (event) => {
        logInkLifecycle("eager_end", event.requestId, event.transcript);
        this.startCartesiaSpeculation(event, generation);
      },
      onTurnResume: (event) => {
        logInkLifecycle("resume", event.requestId);
        this.cancelCartesiaSpeculation("turn_resumed");
      },
      onTurnEnd: (event) => {
        this.inkAudioGate?.endTurn();
        routeInkTurn(event);
      },
      onError: (providerError) => {
        if (generation !== this.connectionGeneration) return;
        console.error("Cartesia Ink error:", providerError);
        // Ink can emit a non-terminal provider error before the socket's
        // close event. Keep the active session listening and let the close
        // handler reconnect only if the transport actually goes away.
        if (!this.inkClient?.isOpen) {
          void this.recoverCartesiaSocket("ink", generation);
        }
      },
      onClose: () => {
        if (generation === this.connectionGeneration && this.active) {
          reportNetworkFailure("cartesia-ink");
          void this.recoverCartesiaSocket("ink", generation);
        }
      },
    });
    this.inkClient = ink;
    this.sonicClient = sonic;
    await Promise.all([ink.connect(), sonic.connect()]);
    if (generation !== this.connectionGeneration || !this.active) {
      ink.close();
      sonic.close();
      await duplexAudio.stopSessionAsync();
      return;
    }
    this.cartesiaActive = true;
    this.usageTracker = null;
    this.inkAudioGate = new InkAudioGate();
    this.duplexSubscriptions = [
      duplexAudio.addAudioInputListener((event) => {
        if (
          generation === this.connectionGeneration &&
          this.active &&
          !this.muted &&
          this.inkClient?.isOpen
        ) {
          for (const frame of this.inkAudioGate?.accept(event) ?? []) {
            this.cartesiaSttSeconds += frame.frames / frame.sampleRate;
            this.inkClient.sendAudio(frame.data);
          }
        }
      }),
      duplexAudio.addPlaybackStateListener((event) => {
        if (generation !== this.connectionGeneration) return;
        this.playbackActive = event.state === "playing";
        if (event.state === "playing" && this.inworldPlaybackStartWatchdog) {
          clearTimeout(this.inworldPlaybackStartWatchdog);
          this.inworldPlaybackStartWatchdog = null;
        }
        this.updateStatus();
        if (!this.playbackActive) {
          this.flushPendingContextRefresh();
          this.flushQueuedResponse();
        }
      }),
      duplexAudio.addErrorListener((audioError) => {
        if (generation !== this.connectionGeneration) return;
        console.error("Duplex audio error:", audioError);
        this.callbacks?.onError(audioError.message);
      }),
    ];
  }

  private async connectAssemblyInworld(generation: number): Promise<void> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) throw new Error("Coach session is not active.");
    const { data: profile } = await supabase
      .from("profiles")
      .select("realtime_coach_voice")
      .maybeSingle();
    const voicePersona = getCoachPersonaId(profile?.realtime_coach_voice);
    this.voicePersona = voicePersona;
    const { data, error } = await supabase.functions.invoke<{
      error?: string;
      provider?: {
        assembly?: { access_token?: string; expires_in?: number };
        inworld?: { access_token?: string; expires_at?: string };
      };
      voice?: { provider_voice_id?: string };
      workout_context?: string | RealtimeWorkoutState;
      state?: { version?: number };
      daily_usage?: { spent_usd: number; budget_usd: number; remaining_usd: number };
    }>("coach-assembly-session", {
      body: {
        day_id: dayId,
        session_key: sessionKey,
        voice_persona: voicePersona,
        state_version: this.stateVersion,
        timer: this.timer,
        conversation_summary: this.conversationSummary,
      },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    const assemblyToken = data?.provider?.assembly?.access_token;
    const inworldToken = data?.provider?.inworld?.access_token;
    const voiceId = data?.voice?.provider_voice_id;
    if (!assemblyToken || !inworldToken || !voiceId) {
      throw new Error(data?.error ?? "AssemblyAI/Inworld voice session was not created.");
    }
    if (data.daily_usage) {
      this.dailySpentBaseline = data.daily_usage.spent_usd;
      this.dailyBudgetUsd = data.daily_usage.budget_usd;
      this.callbacks?.onBudgetUpdate?.(this.dailySpentBaseline, this.dailyBudgetUsd);
    }
    this.stateVersion = Math.max(this.stateVersion, data.state?.version ?? 0);
    this.inworldVoiceId = voiceId;
    this.updateWorkoutState(
      typeof data.workout_context === "string"
        ? data.workout_context
        : JSON.stringify(data.workout_context ?? null),
    );

    const duplexAudio = await import("expo-duplex-audio");
    const permission = await duplexAudio.requestPermissionsAsync();
    if (!permission.granted) throw new Error("Microphone permission is required for Coach.");
    await duplexAudio.startSessionAsync({
      sampleRate: 16000,
      frameDurationMs: 20,
      speaker: true,
      muted: this.muted,
    });
    if (generation !== this.connectionGeneration || !this.active) {
      await duplexAudio.stopSessionAsync();
      return;
    }
    this.duplexAudio = duplexAudio;

    const assembly = new AssemblyRealtimeClient({
      accessToken: assemblyToken,
      keyterms: buildInkKeyterms(
        COACH_INK_KEYTERMS,
        this.orderedDrills().map((drill) => drill.name ?? "").filter(Boolean),
      ),
      prompt:
        "Noisy basketball workout. Keep make, miss, made, and missed distinct. Transcribe basketball commands accurately.",
      agentContext: this.lastDeterministicReply ?? undefined,
      // The active duplex session routes Coach through the speaker. Far-field
      // Voice Focus is therefore the correct default; a future headset route
      // can explicitly select near-field when it controls the audio route.
      voiceFocus: "far-field",
      onSpeechStarted: () => {
        if (
          this.playbackActive ||
          this.generationActive ||
          Date.now() < this.assemblyEchoGuardUntil
        ) {
          // Wait for transcript evidence before treating an Assembly detection
          // as a barge-in; speaker playback otherwise becomes a user turn.
          this.assemblySpeechStartDeferred = true;
          return;
        }
        this.handleAssemblySpeechStart(generation);
      },
      onPartial: (transcript) => {
        // While Coach is speaking, partial ASR is never an interruption. It
        // may be room noise or speaker bleed; exact stop commands are only
        // accepted from a final transcript below.
        if (this.playbackActive || this.generationActive || this.inworldContextId) return;
        const playbackClassification =
          this.playbackActive || Date.now() < this.assemblyEchoGuardUntil
            ? classifyPlaybackTranscript(transcript, this.lastAssemblyCoachSpeech)
            : null;
        if (
          this.assemblySpeechStartDeferred &&
          playbackClassification === "user"
        ) {
          this.assemblySpeechStartDeferred = false;
          // Promote a reliable novel partial immediately so ordinary spoken
          // requests interrupt Coach without waiting for final transcription.
          this.handleAssemblySpeechStart(generation);
        }
        // Do not display Coach's own reflected audio as an athlete transcript.
        // Ambiguous one-word partials remain visible and eligible for commands
        // such as "stop"; a final transcript resolves them safely.
        if (playbackClassification === "echo") return;
        this.callbacks?.onUserTranscript?.(transcript);
        // Assembly normally follows this with a final turn. If that event is
        // lost, do not leave a visible athlete request stranded forever.
        this.scheduleAssemblyPartialFallback(transcript, generation);
      },
      onTurn: (turn) => {
        this.clearAssemblyPartialFallback();
        if (this.playbackActive || this.generationActive || this.inworldContextId) {
          const control = this.parsePlaybackStopCommand(turn.transcript);
          if (
            control &&
            !isLikelyPlaybackEcho(turn.transcript, this.lastAssemblyCoachSpeech)
          ) {
            this.handleAssemblySpeechStart(generation);
          }
          return;
        }
        const fallback = this.lastAssemblyFallbackTranscript;
        const normalize = (value: string) =>
          value.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        if (
          fallback &&
          Date.now() - fallback.at < 5_000 &&
          normalize(fallback.text) === normalize(turn.transcript)
        ) {
          this.lastAssemblyFallbackTranscript = null;
          return;
        }
        this.lastAssemblyFallbackTranscript = null;
        if (this.assemblySpeechStartDeferred) {
          this.assemblySpeechStartDeferred = false;
          if (isLikelyPlaybackEcho(turn.transcript, this.lastAssemblyCoachSpeech)) {
            return;
          }
          // Do not interrupt from partial ASR. A final non-echo transcript is
          // a real natural-language barge-in and may safely stop Coach.
          this.handleAssemblySpeechStart(generation);
        }
        const itemId = `assembly-${turn.turnOrder}-${Date.now()}`;
        this.speechStoppedAtByItem.set(itemId, Date.now());
        this.transcriptRouteQueue = this.transcriptRouteQueue
          .then(() => this.routeTranscribedTurn(turn.transcript, itemId, generation))
          .catch((routeError) => {
            console.error("Failed to route AssemblyAI transcript:", routeError);
          });
      },
      onServerActivity: () => {
        this.assemblyLastServerActivityAt = Date.now();
      },
      onError: (providerError) => {
        console.error("AssemblyAI error:", providerError);
        if (generation === this.connectionGeneration) this.callbacks?.onError(providerError.message);
      },
      onClose: (providerError) => {
        if (generation === this.connectionGeneration && this.active) {
          this.callbacks?.onError(providerError.message);
          // A provider protocol/auth close cannot heal by repeatedly
          // recreating the same session. Surface it so the athlete can retry
          // after configuration is fixed instead of cycling indefinitely.
          void this.disconnect("connect_failed").then(() => {
            this.callbacks?.onStatus("error");
          });
        }
      },
    });
    const inworld = this.createInworldTtsClient(
      inworldToken,
      generation,
      INITIAL_FIRST_AUDIO_TIMEOUT_MS,
    );
    this.assemblyClient = assembly;
    this.inworldClient = inworld;
    try {
      await assembly.connect();
    } catch (error) {
      throw new Error(
        `AssemblyAI streaming connection failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    try {
      await inworld.connect();
    } catch (error) {
      assembly.close();
      throw new Error(
        `Inworld TTS connection failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    if (generation !== this.connectionGeneration || !this.active) {
      assembly.close();
      inworld.close();
      await duplexAudio.stopSessionAsync();
      return;
    }
    this.assemblyInworldActive = true;
    this.assemblySessionStartedAt = Date.now();
    this.assemblyLastServerActivityAt = Date.now();
    this.assemblyHeartbeatWatchdog = setInterval(() => {
      if (
        generation !== this.connectionGeneration ||
        !this.active ||
        !this.assemblyInworldActive
      ) return;
      // AssemblyAI sends Heartbeat every five seconds when heartbeat=true.
      // Three missed heartbeats indicate a half-open mobile WebSocket.
      if (Date.now() - this.assemblyLastServerActivityAt > 15_000) {
        this.recoverAssemblyInworldTransport(
          generation,
          new Error("AssemblyAI connection stopped responding."),
        );
      }
    }, 5_000);
    // The provider streams directly to the device, so report the elapsed
    // provider session while it is active—not only after a model turn or when
    // the overlay closes. This lets the server close the session at the daily
    // budget boundary and keeps a reopened overlay from showing stale credit.
    this.assemblyUsageReportingTimer = setInterval(() => {
      void this.reportAssemblyInworldUsage(false).catch((usageError) => {
        console.warn("Failed to persist AssemblyAI/Inworld usage:", usageError);
      });
    }, 15_000);
    this.inkAudioGate = new InkAudioGate();
    this.duplexSubscriptions = [
      duplexAudio.addAudioInputListener((event) => {
        if (
          generation === this.connectionGeneration &&
          this.active &&
          !this.muted &&
          this.assemblyClient?.isOpen
        ) {
          for (const frame of this.inkAudioGate?.accept(event) ?? []) {
            this.assemblyClient.sendAudio(frame.data);
          }
        }
      }),
      duplexAudio.addPlaybackStateListener((event) => {
        if (generation !== this.connectionGeneration) return;
        this.playbackActive = event.state === "playing";
        if (event.reason === "completed" && !this.generationActive) {
          // The native queue is empty, but far-field microphone capture can
          // still receive the speaker's final syllables. Hold speech-start
          // handling until Assembly provides a transcript we can compare.
          // Keep listening for genuine barge-in, but defer it until transcript
          // evidence arrives. Bluetooth/speaker routes and room reflections
          // commonly outlive the native queue by more than 750 ms.
          this.assemblyEchoGuardUntil = 0;
          this.callbacks?.onCoachPlaybackFinished?.();
        }
        this.updateStatus();
      }),
      duplexAudio.addSessionStateListener((event) => {
        if (
          generation === this.connectionGeneration &&
          event.session === "inactive" &&
          event.reason === "interrupted"
        ) {
          this.recoverAssemblyInworldTransport(
            generation,
            new Error("The device audio session was interrupted."),
          );
        }
      }),
      duplexAudio.addErrorListener((audioError) => {
        if (audioError.fatal) {
          this.recoverAssemblyInworldTransport(generation, audioError);
        } else if (generation === this.connectionGeneration) {
          this.callbacks?.onError(audioError.message);
        }
      }),
    ];
  }

  private createInworldTtsClient(
    accessToken: string,
    generation: number,
    firstAudioTimeoutMs: number,
  ): InworldTtsClient {
    let inworld: InworldTtsClient;
    const ownsActiveSpeech = (identity: InworldRequestIdentity): boolean =>
      generation === this.connectionGeneration &&
      this.active &&
      this.inworldClient === inworld &&
      identity.contextId === this.inworldContextId &&
      this.inworldSpeech?.contextId === identity.contextId &&
      this.inworldSpeech.speechEpoch === this.speechEpoch;

    inworld = new InworldTtsClient({
      accessToken,
      refreshAccessToken: () => this.refreshInworldAccessToken(),
      voiceId: this.inworldVoiceId,
      firstAudioTimeoutMs,
      onAudio: (audio, identity) => {
        if (!ownsActiveSpeech(identity)) return;
        this.playbackEnqueue = this.playbackEnqueue
          .then(() => {
            if (!ownsActiveSpeech(identity)) return;
            return this.duplexAudio?.enqueuePlaybackAsync(audio);
          })
          .then(() => undefined)
          .catch((playbackError) => {
            if (!ownsActiveSpeech(identity)) return;
            console.error("Could not enqueue Inworld speech:", playbackError);
            this.recoverInworldFirstAudio(
              generation,
              inworld,
              identity,
              playbackError instanceof Error
                ? playbackError
                : new Error("Native playback enqueue failed."),
            );
          });
      },
      onFirstAudio: (identity) => {
        if (!ownsActiveSpeech(identity)) return;
        const speech = this.inworldSpeech;
        if (!speech) return;
        speech.firstAudioReceived = true;
        this.scheduleInworldPlaybackStartWatchdog(generation, inworld, identity);
        this.updateStatus();
      },
      onDone: (contextId) => {
        if (
          generation !== this.connectionGeneration ||
          this.inworldClient !== inworld ||
          contextId !== this.inworldContextId
        ) {
          return;
        }
        this.inworldContextId = null;
        this.inworldSpeech = null;
        this.generationActive = false;
        this.updateStatus();
      },
      onBilledCharacters: (count) => {
        this.inworldTtsCharacters += count;
      },
      onError: (providerError, identity) => {
        if (!ownsActiveSpeech(identity)) return;
        console.error("Inworld TTS error:", providerError);
        this.recoverInworldFirstAudio(generation, inworld, identity, providerError);
      },
      onClose: () => undefined,
      onLifecycle: (stage, identity, detail) => {
        if (!ownsActiveSpeech(identity)) return;
        const diagnostic = {
          stage,
          generation,
          client_id: identity.clientId,
          request_id: identity.requestId,
          context_id: identity.contextId,
          speech_epoch: this.speechEpoch,
          ...detail,
        };
        console.info("Inworld TTS lifecycle", diagnostic);
        this.recordInworldDiagnostic(
          `inworld_tts_${stage}`,
          identity.requestId,
          diagnostic,
        );
      },
    });
    return inworld;
  }

  private scheduleInworldPlaybackStartWatchdog(
    generation: number,
    client: InworldTtsClient,
    identity: InworldRequestIdentity,
  ): void {
    if (this.inworldPlaybackStartWatchdog) {
      clearTimeout(this.inworldPlaybackStartWatchdog);
    }
    this.inworldPlaybackStartWatchdog = setTimeout(() => {
      this.inworldPlaybackStartWatchdog = null;
      if (
        generation !== this.connectionGeneration ||
        !this.active ||
        this.playbackActive ||
        this.inworldClient !== client ||
        this.inworldContextId !== identity.contextId
      ) {
        return;
      }
      this.recoverInworldFirstAudio(
        generation,
        client,
        identity,
        new Error("Native playback did not start after Inworld returned PCM."),
      );
    }, 2_500);
  }

  private recordInworldDiagnostic(
    eventType: string,
    requestId: string | null,
    details: Record<string, unknown>,
  ): void {
    this.ttsDiagnosticEvents.push({
      event_type: eventType,
      provider_request_id: requestId,
      details,
    });
    if (this.ttsDiagnosticEvents.length > 200) this.ttsDiagnosticEvents.shift();
    if (!this.ttsDiagnosticFlushTimer && !this.ttsDiagnosticFlushPromise) {
      this.ttsDiagnosticFlushTimer = setTimeout(() => {
        this.ttsDiagnosticFlushTimer = null;
        void this.flushInworldDiagnostics();
      }, 750);
    }
  }

  private async flushInworldDiagnostics(): Promise<void> {
    if (this.ttsDiagnosticFlushPromise || !this.dayId || !this.sessionKey) return;
    const events = this.ttsDiagnosticEvents.splice(0, 50);
    if (!events.length) return;
    this.ttsDiagnosticFlushPromise = supabase.functions
      .invoke("coach-tts-events", {
        body: {
          day_id: this.dayId,
          session_key: this.sessionKey,
          events,
        },
      })
      .then(({ error }) => {
        if (error) throw error;
      })
      .catch((error) => {
        console.warn("Could not persist Inworld TTS diagnostics:", error);
        this.ttsDiagnosticEvents.unshift(...events);
        if (this.ttsDiagnosticEvents.length > 200) {
          this.ttsDiagnosticEvents.length = 200;
        }
      })
      .finally(() => {
        this.ttsDiagnosticFlushPromise = null;
        if (this.ttsDiagnosticEvents.length && !this.ttsDiagnosticFlushTimer) {
          this.ttsDiagnosticFlushTimer = setTimeout(() => {
            this.ttsDiagnosticFlushTimer = null;
            void this.flushInworldDiagnostics();
          }, 5_000);
        }
      });
    await this.ttsDiagnosticFlushPromise;
  }

  private recoverInworldFirstAudio(
    generation: number,
    failedClient: InworldTtsClient,
    identity: InworldRequestIdentity,
    error: Error,
  ): void {
    if (this.inworldRecoveryPromise) return;
    const speech = this.inworldSpeech;
    if (
      generation !== this.connectionGeneration ||
      !this.active ||
      this.inworldClient !== failedClient ||
      !speech ||
      speech.contextId !== identity.contextId
    ) {
      return;
    }
    if (speech.retried) {
      this.finishInworldWithError(generation, error);
      return;
    }
    speech.retried = true;
    const recovery = (async () => {
      failedClient.cancel(identity.contextId);
      failedClient.close();
      this.playbackEnqueue = Promise.resolve();
      await this.duplexAudio?.clearPlaybackAsync().catch(() => undefined);
      const accessToken = await this.refreshInworldAccessToken();
      if (
        generation !== this.connectionGeneration ||
        !this.active ||
        this.inworldClient !== failedClient ||
        this.inworldSpeech !== speech
      ) {
        return;
      }
      const replacement = this.createInworldTtsClient(
        accessToken,
        generation,
        RETRY_FIRST_AUDIO_TIMEOUT_MS,
      );
      this.inworldClient = replacement;
      await replacement.connect();
      if (
        generation !== this.connectionGeneration ||
        !this.active ||
        this.inworldClient !== replacement ||
        this.inworldSpeech !== speech
      ) {
        replacement.close();
        return;
      }
      const retryContextId = `${speech.turnId}:retry`.slice(0, 120);
      speech.contextId = retryContextId;
      speech.firstAudioReceived = false;
      this.inworldContextId = retryContextId;
      replacement.createContext(retryContextId);
      replacement.pushText(retryContextId, speech.text, speech.final);
      if (speech.final && !speech.text.trim()) replacement.finish(retryContextId);
    })()
      .catch((recoveryError) => {
        if (
          generation === this.connectionGeneration &&
          this.active &&
          this.inworldSpeech === speech
        ) {
          this.finishInworldWithError(generation, recoveryError);
        }
      })
      .finally(() => {
        this.inworldRecoveryPromise = null;
      });
    this.inworldRecoveryPromise = recovery;
  }

  private finishInworldWithError(generation: number, error: unknown): void {
    if (generation !== this.connectionGeneration || !this.active) return;
    const contextId = this.inworldContextId;
    const client = this.inworldClient;
    this.inworldContextId = null;
    this.inworldSpeech = null;
    if (this.inworldPlaybackStartWatchdog) {
      clearTimeout(this.inworldPlaybackStartWatchdog);
      this.inworldPlaybackStartWatchdog = null;
    }
    if (contextId) client?.cancel(contextId);
    client?.close();
    if (this.inworldClient === client) this.inworldClient = null;
    this.generationActive = false;
    this.playbackActive = false;
    void this.duplexAudio?.clearPlaybackAsync().catch(() => undefined);
    this.updateStatus();
    this.callbacks?.onError(
      error instanceof Error ? error.message : "Inworld TTS could not produce speech.",
    );
  }

  private async refreshInworldAccessToken(): Promise<string> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey || !this.active) {
      throw new Error("Coach session is not active.");
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("realtime_coach_voice")
      .maybeSingle();
    const { data, error } = await supabase.functions.invoke<{
      error?: string;
      provider?: { inworld?: { access_token?: string } };
      state?: { version?: number };
      workout_context?: string | RealtimeWorkoutState;
    }>("coach-assembly-session", {
      body: {
        day_id: dayId,
        session_key: sessionKey,
        voice_persona: getCoachPersonaId(profile?.realtime_coach_voice),
        state_version: this.stateVersion,
        timer: this.timer,
        conversation_summary: this.conversationSummary,
      },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    const token = data?.provider?.inworld?.access_token;
    if (!token) throw new Error(data?.error ?? "Inworld did not issue a refreshed access token.");
    this.stateVersion = Math.max(this.stateVersion, data.state?.version ?? 0);
    if (data?.workout_context) {
      this.updateWorkoutState(
        typeof data.workout_context === "string"
          ? data.workout_context
          : JSON.stringify(data.workout_context),
      );
    }
    return token;
  }

  private recoverAssemblyInworldTransport(generation: number, error: unknown): void {
    if (
      generation !== this.connectionGeneration ||
      !this.active ||
      !this.assemblyInworldActive
    ) return;
    const message = error instanceof Error ? error.message : "Coach audio stopped working.";
    this.callbacks?.onError(message);
    // A TTS HTTP failure or native audio interruption cannot be repaired by
    // keeping the old Assembly socket and AudioEngine alive. Disconnecting
    // triggers useCoach's existing connection_lost retry with fresh tokens,
    // a new duplex engine, and a new TTS client.
    void this.disconnect("connection_lost");
  }

  private recoverCartesiaSocket(
    kind: "ink" | "sonic",
    generation: number
  ): Promise<void> {
    const existing =
      kind === "ink" ? this.inkReconnectPromise : this.sonicReconnectPromise;
    if (existing) return existing;
    const reconnect = (async () => {
      const client = kind === "ink" ? this.inkClient : this.sonicClient;
      if (!client) return;
      for (const delayMs of [100, 250, 500]) {
        if (generation !== this.connectionGeneration || !this.active) return;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          await client.connect();
          if (client.isOpen) {
            this.callbacks?.onStatus(this.muted ? "muted" : "listening");
            return;
          }
        } catch (error) {
          console.warn(`Cartesia ${kind} reconnect failed:`, error);
        }
      }
      if (generation === this.connectionGeneration && this.active) {
        // Cartesia credentials are intentionally short-lived. A failed
        // socket recovery can therefore be an expired token, and reconnecting
        // this client would reuse that expired credential. End the transport
        // as a normal connection loss so useCoach creates a fresh session and
        // obtains a new provider token.
        await this.disconnect("connection_lost");
      }
    })().finally(() => {
      if (kind === "ink") this.inkReconnectPromise = null;
      else this.sonicReconnectPromise = null;
    });
    if (kind === "ink") this.inkReconnectPromise = reconnect;
    else this.sonicReconnectPromise = reconnect;
    return reconnect;
  }

  updateTimer(timer: TimerState): void {
    this.timer = timer;
  }

  private currentTimerSnapshot(): TimerState {
    const snapshot = this.callbacks?.getTimerState?.() ?? this.timer;
    this.timer = snapshot;
    return snapshot;
  }

  /**
   * Registers a database write initiated outside Coach tools (currently a
   * timer expiry). Every subsequent spoken turn waits for the write and its
   * post-write context pull, so deterministic and model-routed questions see
   * the same authoritative workout state.
   */
  syncExternalWorkoutMutation(mutation: Promise<void>): Promise<void> {
    const tracked = mutation.then(() => this.refreshWorkoutContext());
    this.externalWorkoutMutationPromise = tracked;
    void tracked.finally(() => {
      if (this.externalWorkoutMutationPromise === tracked) {
        this.externalWorkoutMutationPromise = null;
      }
    });
    return tracked;
  }

  private async waitForExternalWorkoutMutation(): Promise<void> {
    const mutation = this.externalWorkoutMutationPromise;
    if (!mutation) return;
    try {
      await mutation;
    } catch (error) {
      console.warn("Timed set completion did not synchronize:", error);
    }
  }

  async refreshWorkoutContext(): Promise<void> {
    this.contextRefreshRequested += 1;
    if (this.contextRefreshPromise) return this.contextRefreshPromise;
    if (!this.active || !this.dayId || !this.sessionKey) return;
    if (this.generationActive || this.toolBusy || this.playbackActive) {
      this.contextRefreshPending = true;
      return;
    }
    this.contextRefreshPromise = (async () => {
      while (
        this.active &&
        this.dayId &&
        this.sessionKey &&
        this.contextRefreshCompleted < this.contextRefreshRequested
      ) {
        const requestVersion = this.contextRefreshRequested;
        const { data, error } = await supabase.functions.invoke<{
        client_workout_context?: string | null;
        updated_instructions?: string | null;
        state_version?: number;
        error?: string;
      }>("coach-tools", {
        body: {
          day_id: this.dayId,
          session_key: this.sessionKey,
          tool_name: "get_workout_position",
          arguments: {},
          refresh_context: true,
        },
      });
        if (error) throw new Error(await edgeFunctionErrorMessage(error));
        if (data?.error) throw new Error(data.error);
        this.updateWorkoutState(data?.client_workout_context);
        this.contextRefreshCompleted = requestVersion;
        if (typeof data?.state_version === "number") {
          this.stateVersion = Math.max(this.stateVersion, data.state_version);
        }
        if (data?.updated_instructions && !this.cartesiaActive) {
          this.sendEvent({
            type: "session.update",
            session: {
              type: "realtime",
              instructions: data.updated_instructions,
            },
          });
        }
      }
    })()
      .catch((err) => {
        console.warn("Failed to refresh coach workout context:", err);
      })
      .finally(() => {
        this.contextRefreshPromise = null;
      });
    return this.contextRefreshPromise;
  }

  private flushPendingContextRefresh(): void {
    if (!this.contextRefreshPending) return;
    if (this.generationActive || this.toolBusy || this.playbackActive || !this.active) return;
    this.contextRefreshPending = false;
    void this.refreshWorkoutContext();
  }

  private updateWorkoutState(serialized: string | null | undefined): void {
    if (!serialized) return;
    try {
      const parsed = JSON.parse(serialized) as RealtimeWorkoutState;
      if (parsed?.sequence?.drills) this.workoutState = parsed;
    } catch {
      console.warn("Could not parse realtime workout state.");
    }
  }

  private reconcileShootingTargetChange(args: Record<string, unknown>): void {
    const drill = this.resolveRealtimeDrill(args);
    if (!drill) return;
    const requestedSet = Number(args.set_number);
    const navigationSet = this.workoutState?.navigation?.current_set_state;
    const setNumber =
      Number.isInteger(requestedSet) && requestedSet > 0
        ? requestedSet
        : navigationSet?.exercise_id === drill.exercise_id
          ? navigationSet.set_number
          : drill.sets.next_unfinished ?? 1;
    const set = drill.set_results.find((entry) => entry.set_number === setNumber);
    if (!set) return;

    const requestedAttempts = Number(args.target_attempts);
    const requestedMakes = Number(args.target_makes);
    const hasAttempts =
      args.target_attempts != null && Number.isInteger(requestedAttempts);
    const hasMakes = args.target_makes != null && Number.isInteger(requestedMakes);
    const previousAttempts = set.target?.attempts ?? drill.target.attempts;
    const previousMakes = set.target?.makes ?? drill.target.makes;
    const nextAttempts = hasAttempts ? requestedAttempts : previousAttempts;
    const nextMakes = hasMakes
      ? requestedMakes
      : hasAttempts &&
          previousMakes != null &&
          previousAttempts != null &&
          previousAttempts > 0
        ? Math.max(1, Math.round((requestedAttempts / previousAttempts) * previousMakes))
        : previousMakes;
    set.target = { ...set.target, makes: nextMakes, attempts: nextAttempts };
    set.remaining = {
      makes:
        nextMakes == null
          ? null
          : Math.max(0, nextMakes - (set.progress?.makes ?? set.makes ?? 0)),
      attempts:
        nextAttempts == null
          ? null
          : Math.max(0, nextAttempts - (set.progress?.attempts ?? set.attempts ?? 0)),
    };

    if (
      navigationSet &&
      navigationSet.exercise_id === drill.exercise_id &&
      navigationSet.set_number === setNumber
    ) {
      navigationSet.target = { makes: nextMakes, attempts: nextAttempts };
      navigationSet.remaining = { ...set.remaining };
    }
    const pending = this.pendingShotSets.get(
      this.pendingShotKey(drill.exercise_id, setNumber)
    );
    if (pending) {
      pending.targetMakes = nextMakes;
      pending.targetAttempts = nextAttempts;
    }
  }

  private pendingShotKey(exerciseId: string, setNumber: number): string {
    return `${exerciseId}:${setNumber}`;
  }

  private resolveRealtimeDrill(args: Record<string, unknown>): RealtimeDrillState | null {
    const drills = this.workoutState?.sequence?.drills ?? [];
    const exerciseId = typeof args.exercise_id === "string" ? args.exercise_id : null;
    if (exerciseId) {
      const exactId = drills.find((drill) => drill.exercise_id === exerciseId);
      if (exactId) return exactId;
    }
    const requestedName = normalizeDrillReference(args.drill_name);
    if (requestedName) {
      const exact = drills.filter(
        (drill) => normalizeDrillReference(drill.name) === requestedName
      );
      if (exact.length === 1) return exact[0];
      const partial = drills.filter((drill) => {
        const name = normalizeDrillReference(drill.name);
        return name.includes(requestedName) || requestedName.includes(name);
      });
      if (partial.length === 1) return partial[0];
    }
    return this.workoutState?.navigation?.next_work_item ?? null;
  }

  private updateBufferedSetInWorkoutState(entry: PendingShotSet): void {
    const state = this.workoutState;
    const drill = state?.sequence?.drills?.find(
      (candidate) => candidate.exercise_id === entry.exerciseId
    );
    if (!drill) return;
    const set = drill.set_results.find((candidate) => candidate.set_number === entry.setNumber);
    if (set) {
      set.makes = entry.makes;
      set.attempts = entry.attempts;
      set.completed = entry.completed;
      set.progress = {
        makes: entry.makes,
        attempts: entry.attempts,
        misses: Math.max(0, entry.attempts - entry.makes),
      };
      set.target = { makes: entry.targetMakes, attempts: entry.targetAttempts };
      set.remaining = {
        makes:
          entry.targetMakes == null ? null : Math.max(0, entry.targetMakes - entry.makes),
        attempts:
          entry.targetAttempts == null
            ? null
            : Math.max(0, entry.targetAttempts - entry.attempts),
      };
    }
    const current = state?.navigation?.current_set_state;
    if (
      current &&
      current.exercise_id === entry.exerciseId &&
      current.set_number === entry.setNumber
    ) {
      current.completed = entry.completed;
      current.progress = {
        makes: entry.makes,
        attempts: entry.attempts,
        misses: Math.max(0, entry.attempts - entry.makes),
      };
      current.target = { makes: entry.targetMakes, attempts: entry.targetAttempts };
      current.remaining = {
        makes:
          entry.targetMakes == null ? null : Math.max(0, entry.targetMakes - entry.makes),
        attempts:
          entry.targetAttempts == null
            ? null
            : Math.max(0, entry.targetAttempts - entry.attempts),
      };
    }
  }

  private async invokeCoachTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CoachToolResponse> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) throw new Error("Coach session is not active.");
    const requestArgs = { ...args };
    if (typeof requestArgs.client_request_id !== "string") {
      requestArgs.client_request_id = createClientRequestId(toolName);
    }
    const { data, error } = await supabase.functions.invoke<CoachToolResponse>("coach-tools", {
      body: {
        day_id: dayId,
        session_key: sessionKey,
        tool_name: toolName,
        arguments: requestArgs,
      },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (!data) throw new Error("Empty tool response.");
    if (data.error) throw new Error(data.error);
    if (data.client_action) {
      let timerAction = data.client_action as ClientTimerAction;
      if (
        timerAction.type === "start_timer" &&
        (!timerAction.timer_exercise_id || !timerAction.timer_set_number)
      ) {
        const current = this.currentSetState();
        const currentDrill = this.currentDrill();
        const isTimedSet =
          current &&
          currentDrill &&
          (
            (current.target.minutes ?? currentDrill.target.minutes ?? 0) > 0 ||
            ["ball_handling", "defense", "conditioning"].includes(
              currentDrill.category ?? ""
            )
          );
        if (isTimedSet) {
          timerAction = {
            ...timerAction,
            timer_exercise_id: current.exercise_id,
            timer_set_number: current.set_number,
          };
        }
      }
      if (timerAction.type === "get_timer_status") {
        return { ...data, result: this.timerStatusReply() };
      }
      this.callbacks?.onTimerAction(timerAction);
    }
    // Buffered shooting writes are surfaced once when the overlay closes,
    // avoiding repeated background pulls for every flushed set.
    if (data.db_changed && toolName !== "save_shooting_results") {
      emitWorkoutUpdated("coach");
    }
    if (typeof data.state_version === "number") {
      this.stateVersion = Math.max(this.stateVersion, data.state_version);
    } else if (data.db_changed) {
      this.stateVersion += 1;
    }
    this.updateWorkoutState(data.client_workout_context);
    if (data.db_changed && toolName === "set_shooting_set_targets") {
      this.reconcileShootingTargetChange(requestArgs);
    }
    if (data.updated_instructions && !this.cartesiaActive) {
      this.sendEvent({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: data.updated_instructions,
        },
      });
    }
    return data;
  }

  private async persistPendingShotSet(key: string): Promise<CoachToolResponse | null> {
    const entry = this.pendingShotSets.get(key);
    if (!entry) return null;
    const data = await this.invokeCoachTool("save_shooting_results", {
      exercise_id: entry.exerciseId,
      drill_name: entry.drillName,
      set_number: entry.setNumber,
      makes: entry.makes,
      attempts: entry.attempts,
      completed: entry.completed,
      client_request_id: entry.requestId,
    });
    // Do not erase a newer shot that arrived while this save was in flight.
    if (this.pendingShotSets.get(key) === entry) {
      this.pendingShotSets.delete(key);
    }
    return data;
  }

  private async flushPendingShotSets(): Promise<void> {
    if (this.shotFlushPromise) return this.shotFlushPromise;
    if (this.pendingShotSets.size === 0) return;
    this.shotFlushPromise = (async () => {
      for (const key of [...this.pendingShotSets.keys()]) {
        await this.persistPendingShotSet(key);
      }
    })().finally(() => {
      this.shotFlushPromise = null;
    });
    return this.shotFlushPromise;
  }

  private bufferedProgressOutput(): string | null {
    const current = this.workoutState?.navigation?.next_work_item;
    if (!current) return null;
    const setNumber = current.set_number ?? current.sets.next_unfinished ?? 1;
    const entry = this.pendingShotSets.get(
      this.pendingShotKey(current.exercise_id, setNumber)
    );
    if (!entry || entry.completed) return null;
    const remainingShots =
      entry.targetAttempts == null ? null : Math.max(0, entry.targetAttempts - entry.attempts);
    const remainingMakes =
      entry.targetMakes == null ? null : Math.max(0, entry.targetMakes - entry.makes);
    return `AUTHORITATIVE CURRENT SET STATE: set ${entry.setNumber}${
      entry.sideLabel ? ` (${entry.sideLabel})` : ""
    }. Actual progress: ${entry.makes} makes in ${entry.attempts} attempts. Prescribed whole-set target: ${
      entry.targetMakes ?? "no makes target"
    } makes in ${entry.targetAttempts ?? "no attempts target"} attempts. Remaining: ${
      remainingMakes ?? "unknown"
    } makes and ${remainingShots ?? "unknown"} attempts. The progress denominator is shots already taken, not the target. Keep the athlete on this set unless they explicitly finish or move on.`;
  }

  private normalizedShotArguments(
    toolName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    if (toolName === "record_make") {
      return { ...args, makes: 1, attempts: 1, update_mode: "increment", completed: false };
    }
    if (toolName === "record_miss") {
      return { ...args, makes: 0, attempts: 1, update_mode: "increment", completed: false };
    }
    if (toolName === "record_makes") {
      const count = Number(args.count);
      return {
        ...args,
        makes: count,
        attempts: count,
        update_mode: "increment",
        completed: false,
      };
    }
    if (toolName === "record_misses") {
      const count = Number(args.count);
      return {
        ...args,
        makes: 0,
        attempts: count,
        update_mode: "increment",
        completed: false,
      };
    }
    if (toolName === "add_shooting_result") {
      return { ...args, update_mode: "increment", completed: false };
    }
    if (toolName === "set_shooting_total") {
      return { ...args, update_mode: "replace" };
    }
    return args;
  }

  private nextIncompleteSetInSameDrill(entry: PendingShotSet): NextSetGuidance | null {
    const drill = this.workoutState?.sequence?.drills?.find(
      (candidate) => candidate.exercise_id === entry.exerciseId
    );
    const nextSet = drill?.set_results
      .filter((set) => !set.completed)
      .sort((a, b) => a.set_number - b.set_number)[0];
    if (!drill || !nextSet) return null;
    return {
      drillName: drill.name ?? entry.drillName,
      setNumber: nextSet.set_number,
      sideLabel: nextSet.side_label ?? null,
    };
  }

  private completedShotReply(
    entry: PendingShotSet,
    nextSetInSameDrill: NextSetGuidance | null
  ): string {
    const result = `Set saved. You shot ${entry.makes} for ${entry.attempts}.`;
    if (nextSetInSameDrill) {
      const side = nextSetInSameDrill.sideLabel ? `, ${nextSetInSameDrill.sideLabel}` : "";
      return `${result} Next up: set ${nextSetInSameDrill.setNumber}${side} of ${nextSetInSameDrill.drillName}.`;
    }
    const next = this.workoutState?.navigation?.next_work_item;
    if (!next || next.set_number == null) {
      return `${result} Workout complete.`;
    }
    const side = next.set_side_label ? `, ${next.set_side_label}` : "";
    if (next.exercise_id === entry.exerciseId) {
      return `${result} Next up: set ${next.set_number}${side} of ${
        next.name ?? entry.drillName
      }.`;
    }
    return `${result} Next up: ${next.name ?? "the next exercise"}, set ${
      next.set_number
    }${side}.`;
  }

  private async bufferShootingResult(
    args: Record<string, unknown>
  ): Promise<{ kind: ToolExecutionKind; output: string }> {
    const drill = this.resolveRealtimeDrill(args);
    if (!drill) {
      return { kind: "read_only", output: "I couldn't uniquely match that workout drill." };
    }
    if (!this.acceptsShotResults(drill)) {
      return {
        kind: "read_only",
        output: this.nonShootingShotReply(drill),
      };
    }
    const requestedSet = Number(args.set_number);
    const setNumber =
      Number.isInteger(requestedSet) && requestedSet > 0
        ? requestedSet
        : this.workoutState?.navigation?.next_work_item?.exercise_id === drill.exercise_id
          ? this.workoutState.navigation.next_work_item.set_number ??
            drill.sets.next_unfinished ??
            1
          : drill.sets.next_unfinished ?? 1;
    const key = this.pendingShotKey(drill.exercise_id, setNumber);
    const saved = drill.set_results.find((set) => set.set_number === setNumber);
    const existing = this.pendingShotSets.get(key);
    const baseMakes = existing?.makes ?? saved?.makes ?? 0;
    const baseAttempts =
      existing?.attempts ?? (saved?.makes != null ? saved.attempts ?? 0 : 0);
    const reportedMakes = Number(args.makes);
    const reportedAttempts = Number(args.attempts);
    // Parsed local commands use `mode`; Realtime tool calls use `update_mode`.
    // Treat either increment marker identically so repeated speech adds to the
    // pending set instead of replacing it with the latest phrase.
    const updateMode =
      args.update_mode === "increment" || args.mode === "increment" ? "increment" : "replace";
    if (!Number.isInteger(reportedMakes) || reportedMakes < 0) {
      return { kind: "read_only", output: "Makes must be a whole number zero or greater." };
    }
    if (
      !Number.isInteger(reportedAttempts) ||
      reportedAttempts < 0 ||
      (reportedAttempts === 0 && (updateMode !== "replace" || reportedMakes !== 0))
    ) {
      return { kind: "read_only", output: "Attempts must be a whole number zero or greater." };
    }
    const merged = mergeShotProgress(
      { makes: baseMakes, attempts: baseAttempts },
      {
        makes: reportedMakes,
        attempts: reportedAttempts,
        mode: updateMode,
      }
    );
    const nextMakes = merged.makes;
    const nextAttempts = merged.attempts;
    const targetMakes = saved?.target?.makes ?? drill.target.makes;
    const targetAttempts = saved?.target?.attempts ?? drill.target.attempts;
    const completed =
      args.completed === true ||
      (updateMode === "increment" &&
        !args.defer_persist &&
        (saved?.completed === true ||
          (targetAttempts != null &&
            targetAttempts > 0 &&
            baseAttempts < targetAttempts &&
            nextAttempts >= targetAttempts)));
    const entry: PendingShotSet = {
      exerciseId: drill.exercise_id,
      drillName: drill.name ?? "current drill",
      setNumber,
      sideLabel: saved?.side_label ?? null,
      makes: nextMakes,
      attempts: nextAttempts,
      targetMakes,
      targetAttempts,
      completed,
      requestId:
        typeof args.client_request_id === "string"
          ? args.client_request_id
          : existing?.requestId,
    };
    this.pendingShotSets.set(key, entry);
    if (updateMode === "increment") {
      this.shotUndoStack.push({
        exerciseId: entry.exerciseId,
        drillName: entry.drillName,
        setNumber: entry.setNumber,
        makes: reportedMakes,
        attempts: reportedAttempts,
      });
      if (this.shotUndoStack.length > 50) this.shotUndoStack.shift();
    }
    this.updateBufferedSetInWorkoutState(entry);
    this.stateVersion += 1;

    const remainingShots =
      targetAttempts == null ? null : Math.max(0, targetAttempts - nextAttempts);
    if (completed) {
      // Capture this before the persistence refresh. Even if refreshed
      // navigation advances too aggressively, an unfinished set in this
      // drill always takes priority over the next exercise.
      const nextSetInSameDrill = this.nextIncompleteSetInSameDrill(entry);
      await this.persistPendingShotSet(key);
      return {
        kind: "completed_shot",
        output: this.completedShotReply(entry, nextSetInSameDrill),
      };
    }
    if (args.persist_session_progress === true) {
      // Absolute totals and explicit corrections must survive a context refresh
      // before the next make/miss. This writes incomplete set progress only;
      // it does not complete or advance the set.
      await this.persistPendingShotSet(key);
    }
    return {
      kind: "buffered_shot",
      output: `You're ${nextMakes} for ${nextAttempts}${
        remainingShots == null
          ? "."
          : `, ${remainingShots} shot${remainingShots === 1 ? "" : "s"} left.`
      }`,
    };
  }

  private acceptsShotResults(drill: RealtimeDrillState | null): boolean {
    return drill?.category === "shooting" || drill?.category === "finishing";
  }

  private nonShootingShotReply(drill: RealtimeDrillState | null): string {
    const minutes =
      drill && this.currentSetState()?.exercise_id === drill.exercise_id
        ? this.currentSetState()?.target.minutes
        : drill?.target.minutes;
    const timerPrompt =
      minutes != null && minutes > 0
        ? ` Would you like me to start the ${minutes}-minute set timer?`
        : "";
    return `You're not on a shooting or finishing drill. You're on ${
      drill?.name ?? "the current drill"
    }.${timerPrompt}`;
  }

  private async correctLastShot(
    from: "make" | "miss",
    to: "make" | "miss",
    requestId: string,
  ): Promise<string> {
    const current = this.currentSetState();
    const drill = this.resolveRealtimeDrill({
      exercise_id: current?.exercise_id,
      drill_name: current?.drill_name,
    });
    if (!drill) return "I couldn't identify the current drill.";
    const setNumber = current?.set_number ?? drill.sets.next_unfinished ?? 1;
    const pending = this.pendingShotSets.get(this.pendingShotKey(drill.exercise_id, setNumber));
    const saved = drill.set_results.find((set) => set.set_number === setNumber);
    const makes = pending?.makes ?? saved?.makes ?? current?.progress.makes ?? 0;
    const attempts = pending?.attempts ?? saved?.attempts ?? current?.progress.attempts ?? 0;
    if (attempts < 1) return "There isn't a shot result to correct in this set yet.";
    if (from === "make" && makes < 1) return "This set does not have a recorded make to change.";
    if (from === "miss" && makes >= attempts) return "This set does not have a recorded miss to change.";

    const result = await this.bufferShootingResult({
      exercise_id: drill.exercise_id,
      drill_name: drill.name,
      set_number: setNumber,
      makes: to === "make" ? makes + 1 : makes - 1,
      attempts,
      mode: "replace",
      completed: false,
      defer_persist: true,
      persist_session_progress: true,
      client_request_id: requestId,
    });
    return result.output;
  }

  private async undoLastShot(): Promise<string> {
    const previous = this.shotUndoStack.pop();
    if (!previous) return "There isn't a recent shot to undo.";
    const drill = this.workoutState?.sequence?.drills?.find(
      (candidate) => candidate.exercise_id === previous.exerciseId
    );
    const saved = drill?.set_results.find(
      (set) => set.set_number === previous.setNumber
    );
    if (!drill || !saved) return "That shot can no longer be undone.";
    const key = this.pendingShotKey(previous.exerciseId, previous.setNumber);
    const existing = this.pendingShotSets.get(key);
    const currentMakes = existing?.makes ?? saved.progress?.makes ?? saved.makes ?? 0;
    const currentAttempts =
      existing?.attempts ?? saved.progress?.attempts ?? saved.attempts ?? 0;
    const entry: PendingShotSet = {
      exerciseId: previous.exerciseId,
      drillName: previous.drillName,
      setNumber: previous.setNumber,
      sideLabel: saved.side_label ?? null,
      makes: Math.max(0, currentMakes - previous.makes),
      attempts: Math.max(0, currentAttempts - previous.attempts),
      targetMakes: saved.target?.makes ?? drill.target.makes,
      targetAttempts: saved.target?.attempts ?? drill.target.attempts,
      completed: false,
      requestId: createClientRequestId("undo-shot"),
    };
    this.pendingShotSets.set(key, entry);
    this.updateBufferedSetInWorkoutState(entry);
    this.stateVersion += 1;
    await this.persistPendingShotSet(key);
    const remaining =
      entry.targetAttempts == null
        ? null
        : Math.max(0, entry.targetAttempts - entry.attempts);
    return `Undid the last shot. You're ${entry.makes} for ${entry.attempts}${
      remaining == null
        ? "."
        : `, ${remaining} shot${remaining === 1 ? "" : "s"} left.`
    }`;
  }

  private orderedDrills(): RealtimeDrillState[] {
    return [...(this.workoutState?.sequence?.drills ?? [])].sort(
      (a, b) => (a.drill_position ?? 0) - (b.drill_position ?? 0)
    );
  }

  private currentDrill(): RealtimeDrillState | null {
    const currentId = this.workoutState?.navigation?.current_set_state?.exercise_id;
    return (
      this.orderedDrills().find((drill) => drill.exercise_id === currentId) ??
      this.workoutState?.navigation?.next_work_item ??
      null
    );
  }

  private currentSetState(): RealtimeCurrentSetState | null {
    return this.workoutState?.navigation?.current_set_state ?? null;
  }

  private resolveNavigationTarget(target: NavigationTarget): RealtimeDrillState | null {
    const drills = this.orderedDrills();
    const current = this.currentDrill();
    const currentIndex = current
      ? drills.findIndex((drill) => drill.exercise_id === current.exercise_id)
      : -1;
    if (target.type === "current") return current;
    if (target.type === "first") return drills[0] ?? null;
    if (target.type === "last") return drills.at(-1) ?? null;
    if (target.type === "ordinal") return drills[target.ordinal - 1] ?? null;
    if (target.type === "from_end") return drills[drills.length - target.offset] ?? null;
    if (target.type === "next") {
      return (
        this.workoutState?.navigation?.next_exercise_after_current ??
        drills.slice(currentIndex + 1).find((drill) => drill.status !== "complete") ??
        null
      );
    }
    if (target.type === "previous") {
      return currentIndex > 0 ? drills[currentIndex - 1] : null;
    }
    if (!("name" in target)) return null;
    const normalizedName = normalizeDrillReference(target.name);
    const matches = drills.filter(
      (drill) => normalizeDrillReference(drill.name) === normalizedName
    );
    return matches.length === 1 ? matches[0] : null;
  }

  private timedSetReply(
    drill: RealtimeDrillState,
    setNumber: number,
    set?: RealtimeSetResult | null
  ): string | null {
    if (!["ball_handling", "defense", "conditioning"].includes(drill.category ?? "")) {
      return null;
    }
    const side = set?.side_label ? `, ${set.side_label}` : "";
    const label = `Set ${setNumber}${side} of ${drill.name ?? "this drill"}`;
    if (set?.completed) return `${label} is complete.`;
    const minutes = set?.target?.minutes ?? drill.target.minutes;
    if (minutes != null && minutes > 0) {
      const duration =
        minutes < 1
          ? `${Math.round(minutes * 60)} seconds`
          : `${Number(minutes.toFixed(2))} minute${minutes === 1 ? "" : "s"}`;
      return `${label} is ${duration}. Do you want me to start the timer?`;
    }
    return `${label} is not complete. Do you want me to start the timer?`;
  }

  private nextWorkReply(unit: "set" | "drill", target: NavigationTarget): string {
    const current = this.currentDrill();
    if (unit === "set" && (target.type === "next" || target.type === "current")) {
      const currentSet = this.currentSetState();
      if (!current || !currentSet) return "There isn't a current set.";
      if (target.type === "next") {
        const currentResult = current.set_results.find(
          (set) => set.set_number === currentSet.set_number
        );
        // `current_set_state` can briefly lag the detailed set list after a
        // local shot/progress update. The detailed record is authoritative for
        // whether this active set is still unfinished, so never skip it based
        // on a stale navigation completion flag.
        const currentSetIncomplete = currentResult
          ? !currentResult.completed
          : !currentSet.completed;
        if (currentSetIncomplete) {
          return `Your next set is set ${currentSet.set_number} of ${
            current.name ?? "this drill"
          }.`;
        }
        const currentIndex = current.set_results.findIndex(
          (set) => set.set_number === currentSet.set_number
        );
        const nextSet = current.set_results
          .slice(currentIndex + 1)
          .find((set) => !set.completed);
        if (nextSet) {
          const timedReply = this.timedSetReply(current, nextSet.set_number, nextSet);
          if (timedReply) return timedReply;
          const side = nextSet.side_label ? `, ${nextSet.side_label}` : "";
          return `Next is set ${nextSet.set_number}${side} of ${
            current.name ?? "the current drill"
          }.`;
        }
        const nextDrill = this.workoutState?.navigation?.next_exercise_after_current;
        if (!nextDrill) return "There are no unfinished sets left.";
        const nextSetNumber = nextDrill.sets.next_unfinished ?? 1;
        const nextDrillSet = nextDrill.set_results.find(
          (set) => set.set_number === nextSetNumber
        );
        return (
          this.timedSetReply(nextDrill, nextSetNumber, nextDrillSet) ??
          `Next is ${nextDrill.name ?? "the next drill"}, set ${nextSetNumber}.`
        );
      }
      if (target.type === "current") {
        const timedReply = this.timedSetReply(
          current,
          currentSet.set_number,
          current.set_results.find((set) => set.set_number === currentSet.set_number)
        );
        if (timedReply) return timedReply;
        const side = currentSet.side_label ? `, ${currentSet.side_label}` : "";
        return `You're on set ${currentSet.set_number}${side} of ${current.name ?? "the current drill"}.`;
      }
    }
    const drill = this.resolveNavigationTarget(target);
    if (!drill) return "There isn't another matching drill.";
    const setNumber =
      target.type === "current"
        ? this.currentSetState()?.set_number ?? drill.sets.next_unfinished ?? 1
        : drill.sets.next_unfinished ?? 1;
    const timedReply = this.timedSetReply(
      drill,
      setNumber,
      drill.set_results.find((set) => set.set_number === setNumber)
    );
    if (timedReply) return timedReply;
    return target.type === "current"
      ? `You're on ${drill.name ?? "the current drill"}, drill ${drill.drill_position ?? 1}.`
      : `Next is ${drill.name ?? "the next drill"}, drill ${drill.drill_position ?? 1}.`;
  }

  private progressReply(
    scope: "set" | "exercise" | "workout",
    metric: "progress" | "percentage" | "remaining" | "target" | "totals",
    totalsField?: "makes" | "misses" | "attempts"
  ): string {
    const current = this.currentDrill();
    const currentSet = this.currentSetState();
    if (metric === "progress") {
      if (scope === "set") {
        if (!currentSet) return "There isn't a current set.";
        return currentSet.completed
          ? `Set ${currentSet.set_number} is complete.`
          : `Set ${currentSet.set_number} is still in progress.`;
      }
      if (scope === "exercise") {
        if (!current) return "There isn't a current drill.";
        const total = current.set_results.length;
        const complete = current.set_results.filter((set) => set.completed).length;
        return `${complete} of ${total} sets complete in ${current.name ?? "this drill"}.`;
      }
      const drills = this.orderedDrills();
      const complete = drills.filter((drill) => drill.status === "complete").length;
      return `${complete} of ${drills.length} drills complete in this workout.`;
    }
    if (metric === "remaining") {
      if (scope === "set") {
        if (!currentSet) return "There isn't a current set.";
        const shots = currentSet.remaining.attempts;
        const makes = currentSet.remaining.makes;
        if (shots == null) return "This set doesn't have a shot target.";
        return `${shots} shot${shots === 1 ? "" : "s"} left${
          makes == null ? "." : ` and ${makes} make${makes === 1 ? "" : "s"} left.`
        }`;
      }
      if (scope === "exercise") {
        if (!current) return "There isn't a current drill.";
        const remainingSets = current.set_results.filter((set) => !set.completed).length;
        return `${remainingSets} set${remainingSets === 1 ? "" : "s"} left in ${
          current.name ?? "this drill"
        }.`;
      }
      const remainingDrills = this.orderedDrills().filter(
        (drill) => drill.status !== "complete"
      ).length;
      return `${remainingDrills} drill${remainingDrills === 1 ? "" : "s"} left in this workout.`;
    }
    if (metric === "target") {
      if (!current || !currentSet) return "There isn't a current set.";
      const targetMakes = currentSet.target.makes;
      const targetAttempts = currentSet.target.attempts;
      if (targetAttempts == null && current.target.minutes) {
        return `The target is ${current.target.minutes} minute${
          current.target.minutes === 1 ? "" : "s"
        } per set.`;
      }
      if (targetAttempts == null) return "This drill doesn't have a shooting target.";
      return `This set's full target is ${targetMakes ?? 0} make${
        targetMakes === 1 ? "" : "s"
      } in ${targetAttempts} attempts. You're currently ${currentSet.progress.makes} for ${
        currentSet.progress.attempts
      }.`;
    }
    let makes = 0;
    let attempts = 0;
    let label = "This workout";
    if (scope === "set") {
      const set = this.currentSetState();
      if (!set) return "There isn't a current set.";
      makes = set.progress.makes;
      attempts = set.progress.attempts;
      label = `Set ${set.set_number}`;
    } else if (scope === "exercise") {
      if (!current) return "There isn't a current drill.";
      makes = current.set_results.reduce((sum, set) => sum + (set.makes ?? 0), 0);
      attempts = current.set_results.reduce((sum, set) => sum + (set.attempts ?? 0), 0);
      label = current.name ?? "This drill";
    } else {
      for (const drill of this.orderedDrills()) {
        makes += drill.set_results.reduce((sum, set) => sum + (set.makes ?? 0), 0);
        attempts += drill.set_results.reduce((sum, set) => sum + (set.attempts ?? 0), 0);
      }
    }
    if (attempts === 0) return `${label} doesn't have any logged shots yet.`;
    const pct = Math.round((makes / attempts) * 100);
    if (metric === "percentage") {
      const scopeLabel =
        scope === "exercise"
          ? "this exercise"
          : scope === "workout"
            ? "this workout"
            : `set ${currentSet?.set_number ?? 1}`;
      return `For ${scopeLabel}, you're ${makes} for ${attempts}. That's ${pct} percent.`;
    }
    if (totalsField === "makes") return `${label}: ${makes} makes.`;
    if (totalsField === "misses") {
      return `${label}: ${Math.max(0, attempts - makes)} misses.`;
    }
    if (totalsField === "attempts") return `${label}: ${attempts} attempts.`;
    return `${label}: ${makes} for ${attempts}, ${Math.max(0, attempts - makes)} misses.`;
  }

  private timerStatusReply(): string {
    const elapsed = Math.max(0, Math.round(this.timer.elapsed_seconds));
    const duration = this.timer.duration_seconds;
    const remaining = this.timer.remaining_seconds == null
      ? duration == null ? null : Math.max(0, Math.round(duration - elapsed))
      : Math.max(0, Math.round(this.timer.remaining_seconds));
    const format = (seconds: number) =>
      seconds < 60
        ? `${seconds} second${seconds === 1 ? "" : "s"}`
        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    if (remaining != null) {
      return this.timer.running
        ? `The timer is running with ${format(remaining)} left.`
        : elapsed > 0
          ? `The timer is paused with ${format(remaining)} left.`
          : this.noTimerReply();
    }
    return this.timer.running
      ? `The timer is running at ${format(elapsed)}.`
      : elapsed > 0
        ? `The timer is paused at ${format(elapsed)}.`
        : this.noTimerReply();
  }

  private hasTimer(): boolean {
    return this.timer.running ||
      this.timer.elapsed_seconds > 0 ||
      this.timer.duration_seconds != null;
  }

  private noTimerReply(): string {
    const drill = this.currentDrill();
    const timed = drill != null && (
      ["ball_handling", "defense", "conditioning"].includes(drill.category ?? "") ||
      (drill.target.minutes ?? 0) > 0
    );
    return timed
      ? "No timer is running right now."
      : "No timer is running right now, and you're not on a timed drill.";
  }

  private timerStartedReply(durationSeconds: number): string {
    const seconds = Math.max(1, Math.round(durationSeconds));
    const duration =
      seconds >= 60 && seconds % 60 === 0
        ? `${seconds / 60}-minute`
        : `${seconds}-second`;
    return `A ${duration} timer has been started.`;
  }

  private timerDurationLabel(durationSeconds: number): string {
    const seconds = Math.max(1, Math.round(durationSeconds));
    if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
    if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"} ${remainder} seconds`;
  }

  private authoritativeTurnInstructions(): string {
    const currentSet = this.currentSetState();
    const currentDrill = this.currentDrill();
    return `Answer the user's latest request concisely. This client state is authoritative and newer than any conflicting conversation state: ${JSON.stringify(
      {
        current_set: currentSet,
        current_drill: currentDrill
          ? {
              exercise_id: currentDrill.exercise_id,
              name: currentDrill.name,
              category: currentDrill.category,
              set_results: currentDrill.set_results,
            }
          : null,
      }
    )}`;
  }

  private async executeDeterministicIntent(
    command: CoachSpeechIntent,
    turn: RoutedCoachTurn
  ): Promise<string | null> {
    const requestArgs = { client_request_id: turn.requestId };
    if (command.kind === "speech_control") {
      // This must stop only Coach audio. It is deliberately separate from
      // timer controls, so "stop talking" can never pause the workout timer.
      this.handleCartesiaSpeechStart(this.connectionGeneration);
      return "";
    }
    if (command.kind === "timer_duration_confirmation") {
      const pending = this.pendingTimerDurationChange;
      this.pendingTimerDurationChange = null;
      if (!pending) return null;
      if (pending.startAfterConfirmation) {
        if (!command.args.accepted) {
          return pending.restartAfterConfirmation
            ? "Okay, I'll leave the current timer running."
            : "Okay, I won't start the timer.";
        }
        this.callbacks?.onTimerAction({
          type: "start_timer",
          duration_seconds: pending.requestedSeconds,
          timer_exercise_id: pending.exerciseId,
          timer_set_number: pending.setNumber,
        });
        return pending.restartAfterConfirmation
          ? this.timerStartedReply(pending.requestedSeconds).replace(
            "has been started",
            "has been restarted",
          )
          : this.timerStartedReply(pending.requestedSeconds);
      }
      const durationSeconds = command.args.accepted
        ? pending.requestedSeconds
        : pending.prescribedSeconds;
      if (command.args.accepted) {
        await this.invokeCoachTool("set_timed_set_duration", {
          exercise_id: pending.exerciseId,
          drill_name: pending.drillName,
          set_number: pending.setNumber,
          duration_seconds: pending.requestedSeconds,
          ...requestArgs,
        });
      }
      this.callbacks?.onTimerAction({
        type: "start_timer",
        duration_seconds: durationSeconds,
        timer_exercise_id: pending.exerciseId,
        timer_set_number: pending.setNumber,
      });
      return command.args.accepted
        ? `Set ${pending.setNumber} is now ${this.timerDurationLabel(
            durationSeconds
          )}. ${this.timerStartedReply(durationSeconds)}`
        : this.timerStartedReply(durationSeconds);
    }
    if (command.kind === "set_completion_confirmation") {
      const pending = this.pendingIncompleteShotCompletion;
      this.pendingIncompleteShotCompletion = null;
      if (!pending) return null;
      if (!command.args.accepted) {
        return `Okay, let's start set ${pending.setNumber} of ${pending.drillName ?? "this drill"}.`;
      }
      return (
        await this.invokeCoachTool("set_set_completion", {
          exercise_id: pending.exerciseId,
          drill_name: pending.drillName,
          set_number: pending.setNumber,
          completed: true,
          confirmed_incomplete: true,
          ...requestArgs,
        })
      ).result;
    }

    if (command.kind === "undo_shot") {
      return this.undoLastShot();
    }

    if (command.kind === "correct_last_shot") {
      return this.correctLastShot(
        command.args.from,
        command.args.to,
        turn.requestId,
      );
    }
    if (command.kind === "continuation_confirmation") {
      const pending = this.pendingIncompleteSetContinuation;
      this.pendingIncompleteSetContinuation = null;
      if (!pending) return null;
      if (!command.args.accepted) {
        return `Okay, we'll stay on set ${pending.setNumber} of ${
          pending.drillName ?? "this drill"
        }.`;
      }
      return this.executeDeterministicIntent(
        {
          kind: "navigation",
          args: { mode: "action", unit: "set", target: { type: "next" }, skip: false },
          confidence: 1,
          heardLabel: "Continue past incomplete set confirmed",
          safeToDelete: true,
        },
        turn
      );
    }

    if (command.kind === "shot") {
      // Validate the active drill before resolving the requested set. Without
      // this, a missing current-set record can fall back to a different drill
      // and incorrectly record a make or miss there.
      const activeDrill = this.currentDrill();
      if (!this.acceptsShotResults(activeDrill)) {
        return this.nonShootingShotReply(activeDrill);
      }
      const current = this.currentSetState();
      const result = await this.bufferShootingResult({
        ...command.args,
        exercise_id: current?.exercise_id,
        drill_name: current?.drill_name,
        set_number: current?.set_number,
        completed: false,
        persist_session_progress: command.args.mode === "replace",
        ...requestArgs,
      });
      return result.output;
    }

    if (command.kind === "timer") {
      const current = this.currentSetState();
      const currentDrill = this.currentDrill();
      const action = command.args.action;
      const isTimedSet = Boolean(
        current &&
          currentDrill &&
          (
            (current.target.minutes ?? currentDrill.target.minutes ?? 0) > 0 ||
            ["ball_handling", "defense", "conditioning"].includes(
              currentDrill.category ?? ""
            )
          )
      );
      // Recognized timer-status questions bypass the model for an immediate,
      // exact reply from the same live local timer used by the UI. The
      // get_timer_status tool remains available for questions that reach
      // Coach's model through another route.
      if (action === "status") return this.timerStatusReply();
      if (action === "pause") {
        const wasRunning = this.timer.running;
        if (!wasRunning && !this.hasTimer()) {
          return `You can't pause the timer because ${this.noTimerReply().toLowerCase()}`;
        }
        if (wasRunning) this.callbacks?.onTimerAction({ type: "pause_timer" });
        return wasRunning ? "Timer paused." : "The timer is already paused.";
      }
      if (action === "resume") {
        const canResume = !this.timer.running && this.timer.elapsed_seconds > 0;
        if (!canResume && !this.hasTimer()) {
          return `You can't resume the timer because ${this.noTimerReply().toLowerCase()}`;
        }
        if (canResume) this.callbacks?.onTimerAction({ type: "resume_timer" });
        return canResume ? "Timer resumed." : "There isn't a paused timer.";
      }
      if (action === "stop" || action === "reset") {
        this.callbacks?.onTimerAction({ type: "stop_timer" });
        return action === "reset" ? "Timer reset." : "Timer stopped.";
      }
      if (action === "restart") {
        if (
          !this.timer.running &&
          this.timer.elapsed_seconds <= 0 &&
          this.timer.duration_seconds == null
        ) {
          return "There isn't a timer to restart.";
        }
        this.callbacks?.onTimerAction({ type: "stop_timer" });
        this.callbacks?.onTimerAction({
          type: "start_timer",
          duration_seconds: this.timer.duration_seconds,
          timer_exercise_id: current?.exercise_id ?? null,
          timer_set_number: current?.set_number ?? null,
        });
        return this.timer.duration_seconds != null
          ? this.timerStartedReply(this.timer.duration_seconds)
          : "Timer restarted.";
      }
      if (command.args.durationSeconds) {
        if (!isTimedSet) {
          return "That set does not use timed sets, so I won't start a timer.";
        }
        const prescribedSeconds =
          current?.target.minutes != null && current.target.minutes > 0
            ? Math.round(current.target.minutes * 60)
            : null;
        if (isTimedSet && prescribedSeconds == null) {
          await this.invokeCoachTool("set_timed_set_duration", {
            exercise_id: current!.exercise_id,
            drill_name: current!.drill_name,
            set_number: current!.set_number,
            duration_seconds: command.args.durationSeconds,
            ...requestArgs,
          });
        }
        if (
          isTimedSet &&
          prescribedSeconds != null &&
          prescribedSeconds !== command.args.durationSeconds
        ) {
          this.pendingTimerDurationChange = {
            exerciseId: current!.exercise_id,
            drillName: current!.drill_name,
            setNumber: current!.set_number,
            prescribedSeconds,
            requestedSeconds: command.args.durationSeconds,
          };
          return `This set is ${this.timerDurationLabel(
            prescribedSeconds
          )}. Do you want to change it to ${this.timerDurationLabel(
            command.args.durationSeconds
          )}?`;
        }
        this.callbacks?.onTimerAction({
          type: "start_timer",
          duration_seconds: command.args.durationSeconds,
          timer_exercise_id: isTimedSet ? current?.exercise_id ?? null : null,
          timer_set_number: isTimedSet ? current?.set_number ?? null : null,
        });
        return this.timerStartedReply(command.args.durationSeconds);
      }
      if (!isTimedSet) {
        return "That set does not use timed sets, so I won't start a timer.";
      }
      const setMinutes = current?.target.minutes ?? currentDrill?.target.minutes;
      const setDurationSeconds =
        setMinutes && setMinutes > 0
          ? Math.round(setMinutes * 60)
          : null;
      if (setDurationSeconds == null) {
        return "Tell me how long you want the timer.";
      }
      this.callbacks?.onTimerAction({
        type: "start_timer",
        duration_seconds: setDurationSeconds,
        timer_exercise_id: current?.exercise_id ?? null,
        timer_set_number: current?.set_number ?? null,
      });
      return this.timerStartedReply(setDurationSeconds);
    }

    if (command.kind === "set_prescription") {
      const current = this.currentDrill();
      const selected = this.currentSetState();
      if (!current) return "There isn't a current drill.";
      const setNumber = command.args.setNumber ?? selected?.set_number;
      if (
        setNumber == null ||
        !current.set_results.some((setResult) => setResult.set_number === setNumber)
      ) {
        return "I couldn't find that set in the current drill.";
      }
      if (command.args.durationSeconds != null) {
        const result = await this.invokeCoachTool("set_timed_set_duration", {
            exercise_id: current.exercise_id,
            drill_name: current.name,
            set_number: setNumber,
            duration_seconds: command.args.durationSeconds,
            ...requestArgs,
          });
        if (result.result.startsWith("Error:")) return result.result;
        const restart = this.timer.running;
        this.pendingTimerDurationChange = {
          exerciseId: current.exercise_id,
          drillName: current.name,
          setNumber,
          prescribedSeconds: command.args.durationSeconds,
          requestedSeconds: command.args.durationSeconds,
          startAfterConfirmation: true,
          restartAfterConfirmation: restart,
        };
        return `${result.result} Would you like me to ${
          restart ? "restart" : "start"
        } the timer?`;
      }
      await this.flushPendingShotSets();
      return (
        await this.invokeCoachTool("set_shooting_set_targets", {
          exercise_id: current.exercise_id,
          drill_name: current.name,
          set_number: setNumber,
          target_makes: command.args.targetMakes,
          target_attempts: command.args.targetAttempts,
          ...requestArgs,
        })
      ).result;
    }

    if (command.kind === "navigation") {
      if (command.args.mode === "query") {
        return this.nextWorkReply(command.args.unit, command.args.target);
      }
      if (command.args.unit === "set") {
        const current = this.currentDrill();
        const currentSet = this.currentSetState();
        if (!current || !currentSet) return null;
        if (
          command.args.resumeCurrentIfIncomplete &&
          !currentSet.completed
        ) {
          this.pendingIncompleteSetContinuation = {
            drillName: current.name,
            setNumber: currentSet.set_number,
          };
          return `You haven't completed set ${currentSet.set_number} of ${
            current.name
          } yet. Would you still like to move on?`;
        }
        const orderedSets = [...current.set_results].sort(
          (a, b) => a.set_number - b.set_number
        );
        const index = orderedSets.findIndex(
          (set) => set.set_number === currentSet.set_number
        );
        const target = command.args.target;
        const nextSet =
          target.type === "first"
            ? orderedSets[0]
            : target.type === "last"
              ? orderedSets.at(-1)
              : target.type === "ordinal"
                ? orderedSets[target.ordinal - 1]
                : target.type === "next"
                  ? orderedSets[index + 1]
                  : target.type === "previous"
                    ? orderedSets[index - 1]
                    : target.type === "current"
                      ? orderedSets[index]
                      : null;
        if (!nextSet) {
          if (target.type !== "next") return null;
          const nextDrill = this.resolveNavigationTarget({ type: "next" });
          if (!nextDrill) return null;
          await this.flushPendingShotSets();
          return (
            await this.invokeCoachTool("set_current_position", {
              exercise_id: nextDrill.exercise_id,
              drill_name: nextDrill.name,
              ...requestArgs,
            })
          ).result;
        }
        await this.flushPendingShotSets();
        return (
          await this.invokeCoachTool("set_current_position", {
            exercise_id: current.exercise_id,
            drill_name: current.name,
            set_number: nextSet.set_number,
            ...requestArgs,
          })
        ).result;
      }
      const current = this.currentDrill();
      if (command.args.skip && current) {
        const target = this.resolveNavigationTarget({ type: "next" });
        if (!target) return null;
        await this.flushPendingShotSets();
        const result = await this.invokeCoachTool("set_current_position", {
          exercise_id: target.exercise_id,
          drill_name: target.name,
          ...requestArgs,
        });
        return result.result;
      }
      const target = this.resolveNavigationTarget(command.args.target);
      if (!target) return null;
      await this.flushPendingShotSets();
      const result = await this.invokeCoachTool("set_current_position", {
        exercise_id: target.exercise_id,
        drill_name: target.name,
        ...requestArgs,
      });
      return result.result;
    }

    if (command.kind === "completion") {
      const current = this.currentDrill();
      const set =
        command.args.setNumber != null && current
          ? current.set_results.find(
              (setResult) => setResult.set_number === command.args.setNumber
            ) ?? null
          : this.currentSetState();
      if (command.args.scope === "workout") {
        return null;
      }
      if (!current) return null;
      await this.flushPendingShotSets();
      if (command.args.scope === "set") {
        if (!set) return null;
        const targetAttempts = set.target?.attempts ?? current.target.attempts;
        const attempts =
          set.progress?.attempts ??
          ("attempts" in set ? set.attempts ?? 0 : 0);
        const makes =
          set.progress?.makes ??
          ("makes" in set ? set.makes ?? 0 : 0);
        if (
          command.args.action === "complete" &&
          this.acceptsShotResults(current) &&
          targetAttempts != null &&
          attempts < targetAttempts
        ) {
          this.pendingIncompleteShotCompletion = {
            exerciseId: current.exercise_id,
            drillName: current.name,
            setNumber: set.set_number,
          };
          return `You're ${makes} for ${attempts}, ${
            targetAttempts - attempts
          } shots left. Would you like to start this set or mark it complete as is?`;
        }
        const result = await this.invokeCoachTool("set_set_completion", {
          exercise_id: current.exercise_id,
          drill_name: current.name,
          set_number: set.set_number,
          completed: command.args.action === "complete",
          ...requestArgs,
        });
        return command.args.action === "complete" && result.db_changed
          ? `Set ${set.set_number} complete. ${this.nextWorkReply("set", {
              type: "next",
            })}`
          : result.result;
      }
      return (
        await this.invokeCoachTool(
          command.args.action === "complete" ? "complete_drill" : "uncomplete_drill",
          {
            exercise_id: current.exercise_id,
            drill_name: current.name,
            ...requestArgs,
          }
        )
      ).result;
    }

    if (command.kind === "progress") {
      return this.progressReply(
        command.args.scope,
        command.args.metric,
        command.args.totalsField
      );
    }
    if (command.kind === "list_drills") {
      const names = this.orderedDrills().map(
        (drill, index) => `${index + 1}, ${drill.name ?? "unnamed drill"}`
      );
      if (names.length === 0) return "There aren't any drills in this workout.";
      return `Your workout drills are: ${names.join("; ")}.`.slice(0, 295);
    }
    if (command.kind === "repeat") return this.lastDeterministicReply;
    if (command.kind === "save_note") {
      return (
        await this.invokeCoachTool("save_note", {
          note: command.args.note,
          ...requestArgs,
        })
      ).result;
    }
    if (command.kind === "remove_drill") {
      const normalized = normalizeDrillReference(command.args.name);
      const matches = this.orderedDrills().filter(
        (drill) => normalizeDrillReference(drill.name) === normalized
      );
      if (matches.length !== 1) return null;
      await this.flushPendingShotSets();
      return (
        await this.invokeCoachTool("remove_workout_exercise", {
          exercise_id: matches[0].exercise_id,
          drill_name: matches[0].name,
          ...requestArgs,
        })
      ).result;
    }
    return null;
  }

  private clearAssemblyPartialFallback(): void {
    if (!this.assemblyPartialFallback) return;
    clearTimeout(this.assemblyPartialFallback.timer);
    this.assemblyPartialFallback = null;
  }

  private parsePlaybackStopCommand(transcript: string): CoachSpeechIntent | null {
    // During speaker playback, only the exact command is safe to treat as a
    // barge-in. Broader phrases can be reflected Coach speech or an athlete
    // beginning a normal request, both of which should wait for playback.
    const normalized = normalizeCoachSpeech(transcript);
    return normalized === "stop" ? parseSpeechControlIntent(normalized) : null;
  }

  private scheduleAssemblyPartialFallback(transcript: string, generation: number): void {
    const text = transcript.trim();
    if (!text || generation !== this.connectionGeneration || !this.active) return;
    this.clearAssemblyPartialFallback();
    const timer = setTimeout(() => {
      const pending = this.assemblyPartialFallback;
      if (
        !pending ||
        pending.timer !== timer ||
        pending.generation !== this.connectionGeneration ||
        !this.active
      ) {
        return;
      }
      this.assemblyPartialFallback = null;
      this.lastAssemblyFallbackTranscript = { text: pending.transcript, at: Date.now() };
      const itemId = `assembly-partial-fallback-${generation}-${Date.now()}`;
      this.speechStoppedAtByItem.set(itemId, Date.now());
      this.transcriptRouteQueue = this.transcriptRouteQueue
        .then(() => this.routeTranscribedTurn(pending.transcript, itemId, generation))
        .catch((routeError) => {
          console.error("Failed to route AssemblyAI fallback transcript:", routeError);
        });
    }, 2_200);
    this.assemblyPartialFallback = { timer, transcript: text, generation };
  }

  private async routeTranscribedTurn(
    transcript: string,
    itemId: string | null,
    generation: number,
    speculation: SpeculativeCoachTurn | null = null,
  ): Promise<void> {
    if (!this.active || generation !== this.connectionGeneration) return;
    await this.waitForExternalWorkoutMutation();
    if (!this.active || generation !== this.connectionGeneration) return;
    const turnId = itemId ?? `transcript-${generation}-${Date.now()}`;
    if (this.routedTurns.has(turnId)) return;
    const turn: RoutedCoachTurn = {
      itemId: turnId,
      transcript,
      requestId: speculation?.turnId ?? `voice-${turnId}`.slice(0, 180),
      speechEpoch: this.speechEpoch,
      eagerEndAt: speculation?.eagerEndAt ?? null,
      speechStoppedAt: this.speechStoppedAtByItem.get(turnId) ?? null,
      transcriptCompletedAt: Date.now(),
      routeDecidedAt: null,
      providerFirstDeltaAt: null,
      sonicFirstTextAt: null,
      sonicFirstAudioAt: null,
      playbackFirstEnqueueAt: null,
      backendCompletedAt: null,
    };
    this.speechStoppedAtByItem.delete(turnId);
    this.routedTurns.set(turnId, turn);
    if (this.playbackActive || this.generationActive || this.inworldContextId) {
      const control = this.parsePlaybackStopCommand(transcript);
      if (
        control &&
        !isLikelyPlaybackEcho(transcript, this.lastAssemblyCoachSpeech)
      ) {
        this.handleAssemblySpeechStart(generation);
      }
      return;
    }
    // Always show the athlete's actual words, including when the local router
    // consumes the command before it reaches Haiku.
    this.callbacks?.onUserTranscript?.(transcript);
    const normalizedReply = normalizeCoachSpeech(transcript);
    const acceptedConfirmation =
      /^(?:(?:i )?(?:say|said)\s+)?(?:yes|yeah|yep|sure|ok|okay|sounds good|do it|use it|change it|change the time|please do|start it|restart it)$/
        .test(normalizedReply);
    const declinedConfirmation =
      /^(?:(?:i )?(?:say|said)\s+)?(?:no|nope|dont|do not|keep it|leave it|keep the time|keep the original)$/
        .test(normalizedReply);
    const acceptedDurationChange =
      acceptedConfirmation ? true : declinedConfirmation ? false : null;
    const incompleteShotCompletionChoice =
      (acceptedConfirmation ||
        /^(?:mark(?: it)? complete|mark(?: it)? as complete|complete(?: it)?|finish(?: it)?|mark(?: it)? done)$/.test(
        normalizedReply
      ))
        ? true
        : /^(?:no|nope|start|start it|lets start|begin)$/.test(
              normalizedReply
            )
          ? false
          : null;
    const incompleteSetContinuationChoice =
      (acceptedConfirmation ||
        /^(?:continue|move on|go ahead)$/.test(
        normalizedReply
      ))
        ? true
        : /^(?:no|nope|dont|do not|stay|stay here|keep me here)$/.test(
              normalizedReply
            )
          ? false
          : null;
    const command: CoachSpeechIntent | null =
      isLikelyTimerStatusQuestion(transcript)
        ? {
          kind: "timer",
          args: { action: "status" },
          confidence: 1,
          heardLabel: "Live timer status heard",
          safeToDelete: true,
        }
        : this.pendingTimerDurationChange && acceptedDurationChange != null
        ? {
            kind: "timer_duration_confirmation",
            args: { accepted: acceptedDurationChange },
            confidence: 1,
            heardLabel: acceptedDurationChange
              ? "Timer duration change confirmed"
              : "Timer duration change declined",
            safeToDelete: true,
          }
        : this.pendingIncompleteShotCompletion && incompleteShotCompletionChoice != null
          ? {
              kind: "set_completion_confirmation",
              args: { accepted: incompleteShotCompletionChoice },
              confidence: 1,
              heardLabel: incompleteShotCompletionChoice
                ? "Incomplete shooting set completion confirmed"
                : "Start incomplete shooting set",
              safeToDelete: true,
            }
          : this.pendingIncompleteSetContinuation &&
              incompleteSetContinuationChoice != null
            ? {
                kind: "continuation_confirmation",
                args: { accepted: incompleteSetContinuationChoice },
                confidence: 1,
                heardLabel: incompleteSetContinuationChoice
                  ? "Continue past incomplete set confirmed"
                  : "Stay on incomplete set",
                safeToDelete: true,
              }
        : parseCoachSpeechIntent(transcript);
    if (this.pendingTimerDurationChange && acceptedDurationChange == null) {
      this.pendingTimerDurationChange = null;
    }
    if (
      this.pendingIncompleteShotCompletion &&
      incompleteShotCompletionChoice == null
    ) {
      this.pendingIncompleteShotCompletion = null;
    }
    if (
      this.pendingIncompleteSetContinuation &&
      incompleteSetContinuationChoice == null
    ) {
      this.pendingIncompleteSetContinuation = null;
    }
    if (!command) {
      turn.routeDecidedAt = Date.now();
      this.fallbackTurnCount += 1;
      this.logVoiceMetric(turn, "route_decision");
      this.latestUserTranscript = transcript;
      if (this.cartesiaActive) {
        if (speculation) {
          await this.promoteCartesiaSpeculation(speculation, turn);
        } else {
          await this.requestCartesiaModelTurn(transcript, turn);
        }
      } else if (this.assemblyInworldActive) {
        await this.requestAssemblyModelTurn(transcript, turn);
      } else {
        this.requestResponse(
          this.authoritativeTurnInstructions(),
          false,
          null,
          transcript
        );
      }
      return;
    }

    if (speculation) speculation.controller.abort();
    if (command.kind === "speech_control") {
      // Ink already interrupted playback when this turn began. Consume the
      // final command here with no model turn, timer action, or spoken
      // acknowledgement, so "stop talking" cannot fall through to
      // pause_timer.
      this.latestUserTranscript = null;
      if (itemId && command.safeToDelete) {
        this.sendEvent({
          type: "conversation.item.delete",
          item_id: itemId,
        });
      }
      this.callbacks?.onCommandHeard?.({
        turnId,
        label: command.heardLabel,
        state: "recognized",
      });
      // This return happens before the command route's normal finally block,
      // so explicitly replace the prior thinking/speaking status.
      this.updateStatus();
      return;
    }
    this.latestUserTranscript = null;
    this.toolBusy = true;
    this.updateStatus();
    try {
      const output = await this.executeDeterministicIntent(command, turn);
      if (generation !== this.connectionGeneration) return;
      if (!output) {
        turn.routeDecidedAt = Date.now();
        turn.backendCompletedAt = turn.routeDecidedAt;
        this.fallbackTurnCount += 1;
        this.logVoiceMetric(turn, "route_decision");
        this.callbacks?.onCommandHeard?.({
          turnId,
          label: command.heardLabel,
          state: "recognized",
        });
        if (this.cartesiaActive) {
          await this.requestCartesiaModelTurn(transcript, turn);
        } else if (this.assemblyInworldActive) {
          await this.requestAssemblyModelTurn(transcript, turn);
        } else {
          this.requestResponse(
            this.authoritativeTurnInstructions(),
            false,
            null,
            transcript
          );
        }
        return;
      }
      turn.routeDecidedAt = turn.routeDecidedAt ?? turn.transcriptCompletedAt;
      turn.backendCompletedAt = Date.now();
      this.deterministicTurnCount += 1;
      this.logVoiceMetric(turn, "backend_complete");
      this.callbacks?.onCommandHeard?.({
        turnId,
        label: command.heardLabel,
        state: "recognized",
      });
      if (itemId && command.safeToDelete) {
        this.sendEvent({
          type: "conversation.item.delete",
          item_id: itemId,
        });
      }
      this.conversationSummary = appendConversationTurn(
        this.conversationSummary,
        transcript,
        output,
      );
      this.lastDeterministicReply = output;
      this.callbacks?.onConversationSummary?.(this.conversationSummary);
      this.callbacks?.onCoachTranscript?.(output);
      if (turn.speechEpoch === this.speechEpoch) {
        await this.speakDeterministic(output, turn.requestId, turn.speechEpoch);
      }
    } catch (err) {
      console.error("Failed to route transcribed coach command:", err);
      if (generation === this.connectionGeneration) {
        this.callbacks?.onCommandHeard?.({
          turnId,
          label: "Command could not be completed",
          state: "failed",
        });
        this.callbacks?.onError(
          err instanceof Error ? err.message : "Could not complete that coach command."
        );
      }
    } finally {
      if (generation === this.connectionGeneration) {
        this.toolBusy = false;
        this.updateStatus();
        this.flushQueuedResponse();
      }
    }
  }

  mute(): void {
    this.muted = true;
    this.inkAudioGate?.endTurn();
    if (this.cartesiaActive || this.assemblyInworldActive) {
      void this.duplexAudio?.setMutedAsync(true).catch((error) => {
        console.warn("Could not mute duplex audio:", error);
      });
    }
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = false;
      }
    }
    this.callbacks?.onStatus("muted" as RealtimeCoachStatus);
  }

  unmute(): void {
    this.muted = false;
    this.inkAudioGate?.endTurn();
    if (this.cartesiaActive || this.assemblyInworldActive) {
      void this.duplexAudio?.setMutedAsync(false).catch((error) => {
        console.warn("Could not unmute duplex audio:", error);
      });
    }
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = true;
      }
    }
    this.updateStatus();
  }

  async disconnect(reason = "manual"): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise;
    if (!this.active && !this.connecting && !this.pc) return;

    this.disconnectPromise = (async () => {
      const callbacks = this.callbacks;
      const usageTracker = this.usageTracker;
      const sessionKey = this.sessionKey;
      const dayId = this.dayId;
      callbacks?.onStatus("disconnecting");
      await this.flushInworldDiagnostics().catch(() => undefined);
      ++this.connectionGeneration;
      this.active = false;
      this.connecting = false;
      this.playbackActive = false;
      this.generationActive = false;
      this.activeResponseId = null;
      this.toolBusy = false;
      this.responseCreatePending = false;
      this.responseQueue = [];
      this.pendingResponseTranscript = null;
      this.responseTranscripts.clear();
      this.responseEpochs.clear();
      this.routedTurns.clear();
      this.speechStoppedAtByItem.clear();
      this.speechEpoch += 1;
      this.playbackGeneration += 1;
      this.cancelCartesiaSpeculation("disconnect");
      this.clearAssemblyPartialFallback();
      this.lastAssemblyFallbackTranscript = null;
      this.latestUserTranscript = null;
      this.contextRefreshPending = false;
      this.pendingEvents = [];

      if (this.disconnectGraceTimeout) clearTimeout(this.disconnectGraceTimeout);
      if (this.responseCreateTimeout) clearTimeout(this.responseCreateTimeout);
      this.disconnectGraceTimeout = null;
      this.responseCreateTimeout = null;

      if (this.pendingShotSets.size > 0 && sessionKey && dayId) {
        try {
          await this.flushPendingShotSets();
        } catch (err) {
          console.error("Failed to save buffered shooting progress before disconnect:", err);
          callbacks?.onError(
            "Your latest shooting progress could not be saved. Check your connection and try again."
          );
        }
      }

      if (this.cartesiaActive) {
        await this.reportCartesiaUsage(true);
      }
      if (this.assemblyInworldActive) {
        await this.reportAssemblyInworldUsage(true);
      }
      this.turnAbortController?.abort();
      this.turnAbortController = null;
      try {
        this.sonicContext?.cancel();
      } catch {
        // Already completed.
      }
      this.sonicContext = null;
      this.inkClient?.close();
      this.sonicClient?.close();
      this.assemblyClient?.close();
      this.inworldClient?.close();
      this.inkClient = null;
      this.sonicClient = null;
      this.assemblyClient = null;
      this.inworldClient = null;
      this.inworldContextId = null;
      this.inworldSpeech = null;
      this.inworldRecoveryPromise = null;
      this.stopLocalShotPlayback?.();
      this.stopLocalShotPlayback = null;
      this.assemblySpeechStartDeferred = false;
      this.assemblyEchoGuardUntil = 0;
      this.assemblyLastServerActivityAt = 0;
      if (this.assemblyHeartbeatWatchdog) {
        clearInterval(this.assemblyHeartbeatWatchdog);
        this.assemblyHeartbeatWatchdog = null;
      }
      if (this.assemblyUsageReportingTimer) {
        clearInterval(this.assemblyUsageReportingTimer);
        this.assemblyUsageReportingTimer = null;
      }
      this.lastAssemblyCoachSpeech = null;
      for (const subscription of this.duplexSubscriptions) subscription.remove();
      this.duplexSubscriptions = [];
      if (this.duplexAudio) {
        await this.duplexAudio.clearPlaybackAsync().catch(() => undefined);
        await this.duplexAudio.stopSessionAsync().catch(() => undefined);
      }
      this.duplexAudio = null;
      this.inkAudioGate = null;
      this.cartesiaActive = false;
      this.assemblyInworldActive = false;
      this.voiceProvider = "cartesia";
      this.cartesiaVoiceId = "";
      this.inworldVoiceId = "";
      this.ttsInputBuffer = "";
      this.ttsSafetyBlocked = false;
      this.playbackEnqueue = Promise.resolve();

      try {
        this.dc?.close();
      } catch {
        // Already closed.
      }
      this.dc = null;

      if (this.localStream) {
        for (const track of this.localStream.getTracks()) track.stop();
        this.localStream = null;
      }
      if (this.remoteStream) {
        for (const track of this.remoteStream.getTracks()) track.stop();
        this.remoteStream = null;
      }
      try {
        this.pc?.close();
      } catch {
        // Already closed.
      }
      this.pc = null;
      await stopVoiceCallAudio();

      if (usageTracker && sessionKey && !this.loggedUsageSessionKeys.has(sessionKey)) {
        this.loggedUsageSessionKeys.add(sessionKey);
        const totals = usageTracker.snapshot();
        callbacks?.onUsage?.(totals);
        const daily = await logCoachUsage({
          dayId,
          sessionKey,
          totals,
          finalizeSession: true,
        }).catch((err) => {
          console.warn("Failed to persist coach usage:", err);
          return null;
        });
        if (daily) {
          callbacks?.onBudgetUpdate?.(daily.spentUsd, daily.budgetUsd);
        }
      }

      this.sessionKey = null;
      this.usageTracker = null;
      this.handledToolCalls.clear();
      if (reason === "daily_budget") {
        callbacks?.onStatus("budget_exhausted");
      } else if (reason !== "connect_failed" && reason !== "connection_lost") {
        callbacks?.onStatus("idle");
      }
      callbacks?.onSessionEnded?.(reason);
    })();

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  private sendEvent(event: Record<string, unknown>, queueIfConnecting = true): boolean {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
      return true;
    }
    if (queueIfConnecting && this.active && this.connecting) {
      this.pendingEvents.push(event);
    }
    return false;
  }

  private flushPendingEvents(): void {
    const pending = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of pending) this.sendEvent(event, false);
  }

  private handleDataChannelMessage(raw: string | ArrayBuffer): void {
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const event = JSON.parse(text) as { type: string; [key: string]: unknown };
      this.processServerEvent(event);
    } catch (err) {
      console.warn("Failed to parse realtime event:", err);
    }
  }

  private updateStatus(): void {
    if (!this.active) return;
    if (this.muted) {
      this.callbacks?.onStatus("muted");
    } else if (this.playbackActive) {
      this.callbacks?.onStatus("speaking");
    } else if (this.toolBusy || this.generationActive || this.responseCreatePending) {
      this.callbacks?.onStatus("thinking");
    } else {
      this.callbacks?.onStatus("listening");
    }
  }

  private logVoiceMetric(
    turn: RoutedCoachTurn,
    stage:
      | "route_decision"
      | "first_provider_delta"
      | "first_sonic_text"
      | "first_sonic_audio"
      | "first_playback_enqueue"
      | "backend_complete"
  ): void {
    const now = Date.now();
    const totalRoutes = this.deterministicTurnCount + this.fallbackTurnCount;
    console.info(
      "[coach_voice_metric]",
      JSON.stringify({
        stage,
        turn_id: turn.itemId,
        eager_end_to_final_ms:
          turn.eagerEndAt == null
            ? null
            : Math.max(0, turn.transcriptCompletedAt - turn.eagerEndAt),
        speech_stop_to_transcript_ms:
          turn.speechStoppedAt == null
            ? null
            : Math.max(0, turn.transcriptCompletedAt - turn.speechStoppedAt),
        transcript_to_route_ms:
          turn.routeDecidedAt == null
            ? null
            : Math.max(0, turn.routeDecidedAt - turn.transcriptCompletedAt),
        route_to_backend_ms:
          turn.routeDecidedAt == null || turn.backendCompletedAt == null
            ? null
            : Math.max(0, turn.backendCompletedAt - turn.routeDecidedAt),
        backend_to_stage_ms:
          turn.backendCompletedAt == null ? null : Math.max(0, now - turn.backendCompletedAt),
        final_to_provider_first_delta_ms:
          turn.providerFirstDeltaAt == null
            ? null
            : Math.max(0, turn.providerFirstDeltaAt - turn.transcriptCompletedAt),
        final_to_sonic_text_ms:
          turn.sonicFirstTextAt == null
            ? null
            : Math.max(0, turn.sonicFirstTextAt - turn.transcriptCompletedAt),
        final_to_sonic_audio_ms:
          turn.sonicFirstAudioAt == null
            ? null
            : Math.max(0, turn.sonicFirstAudioAt - turn.transcriptCompletedAt),
        final_to_playback_enqueue_ms:
          turn.playbackFirstEnqueueAt == null
            ? null
            : Math.max(0, turn.playbackFirstEnqueueAt - turn.transcriptCompletedAt),
        deterministic_route_pct:
          totalRoutes === 0
            ? 0
            : Math.round((this.deterministicTurnCount / totalRoutes) * 100),
        fallback_route_pct:
          totalRoutes === 0 ? 0 : Math.round((this.fallbackTurnCount / totalRoutes) * 100),
      })
    );
  }

  private startCartesiaSpeculation(event: InkTranscriptEvent, generation: number): void {
    const transcript = event.transcript.trim();
    if (
      !transcript ||
      generation !== this.connectionGeneration ||
      !this.active ||
      !isSafeSpeculativeTranscript(transcript) ||
      isLikelyTimerStatusQuestion(transcript) ||
      parseCoachSpeechIntent(transcript)
    ) {
      return;
    }
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) return;

    this.cancelCartesiaSpeculation("superseded");
    const controller = new AbortController();
    const speculation: SpeculativeCoachTurn = {
      inkRequestId: event.requestId,
      turnId: `spec-${event.requestId}-${Date.now()}`.slice(0, 180),
      transcript,
      normalizedTranscript: transcript,
      speechEpoch: this.speechEpoch,
      stateVersion: this.stateVersion,
      eagerEndAt: Date.now(),
      controller,
      events: [],
      responseText: "",
      promoted: false,
      routedTurn: null,
      promise: Promise.resolve(),
      error: null,
    };
    speculation.promise = streamCoachTurn({
      dayId,
      sessionKey,
      turnId: speculation.turnId,
      transcript,
      stateVersion: speculation.stateVersion,
      conversationSummary: this.conversationSummary,
      speculative: true,
      signal: controller.signal,
      onEvent: (streamEvent) => {
        if (
          controller.signal.aborted ||
          speculation.speechEpoch !== this.speechEpoch
        ) {
          return;
        }
        speculation.events.push(streamEvent);
        if (streamEvent.type === "text_delta") {
          speculation.responseText += streamEvent.delta;
        }
        if (speculation.promoted && speculation.routedTurn) {
          this.applyCartesiaTurnEvent(
            streamEvent,
            speculation.turnId,
            speculation.speechEpoch,
            speculation.routedTurn,
          );
        }
      },
    }).catch((error) => {
      if (!controller.signal.aborted) speculation.error = error;
    });
    this.speculativeTurn = speculation;
  }

  private cancelCartesiaSpeculation(_reason: string): void {
    const speculation = this.speculativeTurn;
    this.speculativeTurn = null;
    if (speculation && !speculation.promoted) speculation.controller.abort();
  }

  private takeMatchingSpeculation(
    event: InkTranscriptEvent,
    speechEpoch: number
  ): SpeculativeCoachTurn | null {
    const speculation = this.speculativeTurn;
    this.speculativeTurn = null;
    if (!speculation) return null;
    const matches = shouldPromoteSpeculation(
      {
        inkRequestId: speculation.inkRequestId,
        transcript: speculation.normalizedTranscript,
        speechEpoch: speculation.speechEpoch,
        stateVersion: speculation.stateVersion,
        aborted: speculation.controller.signal.aborted,
      },
      {
        inkRequestId: event.requestId,
        transcript: event.transcript,
        speechEpoch,
        stateVersion: this.stateVersion,
      }
    );
    if (!matches) {
      speculation.controller.abort();
      return null;
    }
    return speculation;
  }

  private handleCartesiaSpeechStart(generation: number): void {
    if (generation !== this.connectionGeneration || !this.active) return;
    this.cancelCartesiaSpeculation("new_speech");
    this.latestUserTranscript = null;
    this.speechEpoch += 1;
    this.playbackGeneration += 1;
    this.responseQueue = [];
    this.turnAbortController?.abort();
    this.turnAbortController = null;
    try {
      this.sonicContext?.cancel();
    } catch {
      // The context may already have completed.
    }
    this.sonicContext = null;
    this.ttsInputBuffer = "";
    this.ttsSafetyBlocked = false;
    this.playbackEnqueue = Promise.resolve();
    this.replayableSonicSpeech = null;
    this.sonicAudioEnqueuedEpoch = null;
    this.generationActive = false;
    this.playbackActive = false;
    void this.duplexAudio?.clearPlaybackAsync().catch(() => undefined);
    this.callbacks?.onStatus(this.muted ? "muted" : "listening");
  }

  private handleAssemblySpeechStart(generation: number): void {
    if (generation !== this.connectionGeneration || !this.active) return;
    this.cancelCartesiaSpeculation("new_speech");
    this.latestUserTranscript = null;
    this.speechEpoch += 1;
    this.playbackGeneration += 1;
    this.stopLocalShotPlayback?.();
    this.stopLocalShotPlayback = null;
    this.turnAbortController?.abort();
    this.turnAbortController = null;
    const contextId = this.inworldContextId;
    this.inworldContextId = null;
    this.inworldSpeech = null;
    if (contextId) {
      this.inworldClient?.cancel(contextId);
    }
    this.ttsInputBuffer = "";
    this.generationActive = false;
    this.playbackActive = false;
    void this.duplexAudio?.clearPlaybackAsync().catch(() => undefined);
    this.callbacks?.onStatus(this.muted ? "muted" : "listening");
  }

  private async speakInworldText(text: string, speechEpoch: number): Promise<void> {
    if (!text.trim() || speechEpoch !== this.speechEpoch || !this.active) return;
    const inworld = this.inworldClient;
    if (!inworld?.isOpen) throw new Error("Inworld speech is not connected.");
    const turnId = `${this.sessionKey ?? "session"}:${speechEpoch}:${++this.inworldTurnSequence}`;
    const contextId = `${turnId}:initial`.slice(0, 120);
    this.inworldContextId = contextId;
    this.inworldSpeech = {
      turnId,
      speechEpoch,
      contextId,
      text,
      final: true,
      retried: false,
      firstAudioReceived: false,
    };
    this.generationActive = true;
    this.updateStatus();
    inworld.createContext(contextId);
    inworld.pushText(contextId, text, true);
    this.lastAssemblyCoachSpeech = text;
    this.assemblyClient?.updateAgentContext(text);
  }

  private pushInworldChunk(text: string, speechEpoch: number, final = false): void {
    if (!text.trim() || speechEpoch !== this.speechEpoch || !this.active) return;
    const inworld = this.inworldClient;
    if (!inworld?.isOpen) throw new Error("Inworld speech is not connected.");
    let contextId = this.inworldContextId;
    if (!contextId) {
      const turnId = `${this.sessionKey ?? "session"}:${speechEpoch}:${++this.inworldTurnSequence}`;
      contextId = `${turnId}:initial`.slice(0, 120);
      this.inworldContextId = contextId;
      this.inworldSpeech = {
        turnId,
        speechEpoch,
        contextId,
        text: "",
        final: false,
        retried: false,
        firstAudioReceived: false,
      };
      this.lastAssemblyCoachSpeech = "";
      this.generationActive = true;
      this.updateStatus();
      inworld.createContext(contextId);
    }
    const speech = this.inworldSpeech;
    if (!speech || speech.contextId !== contextId) return;
    speech.text += text;
    speech.final ||= final;
    this.lastAssemblyCoachSpeech = `${this.lastAssemblyCoachSpeech ?? ""}${text}`;
    inworld.pushText(contextId, text, final);
  }

  private applyAssemblyTurnEvent(
    event: CoachTurnStreamEvent,
    turnId: string,
    speechEpoch: number,
  ): void {
    if (
      !this.active ||
      speechEpoch !== this.speechEpoch ||
      event.turn_id !== turnId
    ) return;
    if ("state_version" in event) this.stateVersion = event.state_version;
    if (event.type === "turn_started") {
      this.model = event.model;
      this.stateFingerprint = event.state_fingerprint;
      return;
    }
    if (event.type === "text_delta") {
      this.streamedCoachTranscript += event.delta;
      this.callbacks?.onCoachTranscript?.(this.streamedCoachTranscript);
      this.ttsInputBuffer += event.delta;
      const drained = drainSonicTextChunks(this.ttsInputBuffer, false);
      this.ttsInputBuffer = drained.remainder;
      for (const chunk of drained.chunks) {
        const gate = gateCoachSpeechText(chunk, true);
        if (gate.status !== "safe") continue;
        try {
          this.pushInworldChunk(gate.speech, speechEpoch);
        } catch (error) {
          if (speechEpoch === this.speechEpoch) this.callbacks?.onError(
            error instanceof Error ? error.message : "Coach speech failed.",
          );
        }
      }
      return;
    }
    if (event.type === "tool_result") {
      const action = event.client_action as ClientTimerAction | null;
      if (action?.type === "get_timer_status") {
        const reply = this.timerStatusReply();
        this.lastDeterministicReply = reply;
        this.callbacks?.onCoachTranscript?.(reply);
        void this.speakDeterministic(reply, event.turn_id, speechEpoch);
      }
      if (action && ["start_timer", "pause_timer", "resume_timer", "stop_timer"].includes(action.type)) {
        this.callbacks?.onTimerAction(action);
      }
      this.updateWorkoutState(event.workout_context);
      if (event.db_changed) emitWorkoutUpdated("coach");
      return;
    }
    if (event.type === "turn_completed") {
      this.stateFingerprint = event.state_fingerprint;
      this.updateWorkoutState(event.workout_context);
      if (event.daily_usage) {
        this.dailySpentBaseline = event.daily_usage.spent_usd;
        this.dailyBudgetUsd = event.daily_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(event.daily_usage.spent_usd, event.daily_usage.budget_usd);
      }
      const drained = drainSonicTextChunks(this.ttsInputBuffer, true);
      this.ttsInputBuffer = "";
      for (const chunk of drained.chunks) {
        const gate = gateCoachSpeechText(chunk, true);
        if (gate.status === "safe") this.pushInworldChunk(gate.speech, speechEpoch);
      }
      const contextId = this.inworldContextId;
      if (contextId) {
        if (this.inworldSpeech?.contextId === contextId) {
          this.inworldSpeech.final = true;
        }
        this.inworldClient?.finish(contextId);
      }
      return;
    }
    if (event.type === "error") throw new Error(event.error);
  }

  private async requestAssemblyModelTurn(
    transcript: string,
    turn: RoutedCoachTurn,
  ): Promise<void> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) throw new Error("Coach session is not active.");
    const speechEpoch = turn.speechEpoch;
    const controller = new AbortController();
    this.turnAbortController?.abort();
    this.turnAbortController = controller;
    this.generationActive = true;
    this.updateStatus();
    let responseText = "";
    this.streamedCoachTranscript = "";
    try {
      await streamCoachTurn({
        dayId,
        sessionKey,
        turnId: turn.requestId,
        transcript,
        stateVersion: this.stateVersion,
        conversationSummary: this.conversationSummary,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "text_delta") responseText += event.delta;
          this.applyAssemblyTurnEvent(event, turn.requestId, speechEpoch);
        },
      });
      if (speechEpoch !== this.speechEpoch) return;
      if (responseText.trim()) {
        const gate = gateCoachSpeechText(responseText.trim(), true);
        if (gate.status === "safe") {
          this.conversationSummary = appendConversationTurn(
            this.conversationSummary,
            transcript,
            gate.speech,
          );
          this.callbacks?.onConversationSummary?.(this.conversationSummary);
          this.callbacks?.onCoachTranscript?.(gate.speech);
          this.lastAssemblyCoachSpeech = gate.speech;
          this.assemblyClient?.updateAgentContext(gate.speech);
        }
      }
      turn.backendCompletedAt = Date.now();
      this.logVoiceMetric(turn, "backend_complete");
    } finally {
      if (this.turnAbortController === controller) this.turnAbortController = null;
      if (speechEpoch === this.speechEpoch) {
        this.generationActive = false;
        this.updateStatus();
      }
      void this.reportAssemblyInworldUsage(false);
    }
  }

  private createSonicContext(
    speechEpoch: number,
    turn?: RoutedCoachTurn
  ): CartesiaSonicContext {
    const sonic = this.sonicClient;
    if (!sonic?.isOpen || !this.cartesiaVoiceId) {
      throw new Error("Coach speech is not connected.");
    }
    const playbackGeneration = this.playbackGeneration;
    const context = sonic.createContext({
      contextId: `${
        this.sessionKey ?? "session"
      }:${speechEpoch}:${playbackGeneration}:${Date.now()}`.slice(0, 120),
      voiceId: this.cartesiaVoiceId,
      encoding: "pcm_s16le",
      sampleRate: 24000,
      language: "en",
      maxBufferDelayMs: 0,
      generationConfig: {
        speed: 1.05,
        volume: 1.08,
        emotion: "happy",
      },
      onChunk: (event) => {
        if (!shouldAcceptPlaybackChunk(
          {
            speechEpoch: this.speechEpoch,
            playbackGeneration: this.playbackGeneration,
            contextId: this.sonicContext?.id ?? null,
            active: this.active,
          },
          { speechEpoch, playbackGeneration, contextId: event.contextId }
        )) {
          return;
        }
        if (turn && turn.sonicFirstAudioAt == null) {
          turn.sonicFirstAudioAt = Date.now();
          this.logVoiceMetric(turn, "first_sonic_audio");
        }
        const encoded = bytesToBase64(event.audio);
        this.playbackEnqueue = this.playbackEnqueue
          .then(() => {
            if (!shouldAcceptPlaybackChunk(
              {
                speechEpoch: this.speechEpoch,
                playbackGeneration: this.playbackGeneration,
                contextId: this.sonicContext?.id ?? null,
                active: this.active,
              },
              { speechEpoch, playbackGeneration, contextId: event.contextId }
            )) {
              return;
            }
            if (turn && turn.playbackFirstEnqueueAt == null) {
              turn.playbackFirstEnqueueAt = Date.now();
              this.logVoiceMetric(turn, "first_playback_enqueue");
            }
            this.sonicAudioEnqueuedEpoch = speechEpoch;
            return this.duplexAudio?.enqueuePlaybackAsync(encoded);
          })
          .then(() => undefined)
          .catch((error) => {
            console.error("Could not enqueue Cartesia speech:", {
              context_id: event.contextId,
              speech_epoch: speechEpoch,
              error,
            });
            reportNetworkFailure("cartesia-playback");
          });
      },
      onDone: () => {
        if (speechEpoch !== this.speechEpoch) return;
        this.generationActive = false;
        this.updateStatus();
      },
      onError: (error) => {
        if (speechEpoch !== this.speechEpoch) return;
        this.generationActive = false;
        console.error("Cartesia Sonic context error:", {
          speech_epoch: speechEpoch,
          context_id: this.sonicContext?.id ?? null,
          audio_enqueued: this.sonicAudioEnqueuedEpoch === speechEpoch,
          error: error.message,
        });
        this.retrySonicSpeechBeforeAudio(speechEpoch);
        this.updateStatus();
      },
    });
    this.sonicContext = context;
    return context;
  }

  private retrySonicSpeechBeforeAudio(speechEpoch: number): void {
    const replay = this.replayableSonicSpeech;
    if (
      !replay ||
      replay.speechEpoch !== speechEpoch ||
      replay.retried ||
      this.sonicAudioEnqueuedEpoch === speechEpoch ||
      !this.active ||
      this.ttsSafetyBlocked
    ) {
      return;
    }
    replay.retried = true;
    try {
      this.sonicContext?.cancel();
    } catch {
      // The failed context may already be closed.
    }
    this.sonicContext = null;
    try {
      const retryContext = this.createSonicContext(speechEpoch);
      this.generationActive = true;
      retryContext.finish(replay.text);
      console.warn("Retrying Cartesia Sonic speech before first audio.", {
        speech_epoch: speechEpoch,
        characters: replay.text.length,
      });
    } catch (retryError) {
      console.error("Could not recreate Cartesia Sonic context:", retryError);
      void this.recoverCartesiaSocket("sonic", this.connectionGeneration);
    }
  }

  private flushSonicText(force: boolean, turn?: RoutedCoachTurn): void {
    const context = this.sonicContext;
    const speechEpoch = turn?.speechEpoch ?? this.speechEpoch;
    if (this.ttsSafetyBlocked) {
      return;
    }
    if (!context) return;
    if (!this.ttsInputBuffer) {
      if (force) context.finish();
      return;
    }
    const bufferedGate = gateCoachSpeechText(this.ttsInputBuffer, force);
    if (bufferedGate.status === "hold") return;
    if (bufferedGate.status === "unsafe") {
      this.blockUnsafeSpeech(speechEpoch);
      return;
    }
    const drained = drainSonicTextChunks(this.ttsInputBuffer, force);
    this.ttsInputBuffer = drained.remainder;
    const gatedChunks = drained.chunks.map((chunk) => gateCoachSpeechText(chunk, true));
    if (gatedChunks.some((result) => result.status !== "safe")) {
      this.blockUnsafeSpeech(speechEpoch);
      return;
    }
    const chunks = gatedChunks
      .map((result) => result.speech)
      .filter((speech) => speech.trim());
    if (chunks.length === 0) {
      if (force) context.finish();
      return;
    }
    const spoken = chunks.join("");
    if (this.replayableSonicSpeech?.speechEpoch === speechEpoch) {
      this.replayableSonicSpeech.text += spoken;
    } else {
      this.replayableSonicSpeech = {
        text: spoken,
        speechEpoch,
        retried: false,
      };
    }
    if (turn && turn.sonicFirstTextAt == null) {
      turn.sonicFirstTextAt = Date.now();
      this.logVoiceMetric(turn, "first_sonic_text");
    }
    this.cartesiaTtsCharacters += chunks.reduce((sum, speech) => sum + speech.length, 0);
    chunks.forEach((speech, index) => {
      if (force && index === chunks.length - 1) context.finish(speech);
      else context.push(speech);
    });
  }

  private blockUnsafeSpeech(speechEpoch: number): void {
    if (this.ttsSafetyBlocked || speechEpoch !== this.speechEpoch) return;
    this.ttsSafetyBlocked = true;
    this.ttsInputBuffer = "";
    this.playbackGeneration += 1;
    try {
      this.sonicContext?.cancel();
    } catch {
      // The provider may already have completed the unsafe context.
    }
    this.sonicContext = null;
    this.playbackEnqueue = Promise.resolve();
    this.replayableSonicSpeech = null;
    void this.duplexAudio?.clearPlaybackAsync().catch(() => undefined);
    console.warn("Suppressed unsafe internal syntax from coach speech.");
  }

  private applyCartesiaTurnEvent(
    event: CoachTurnStreamEvent,
    turnId: string,
    speechEpoch: number,
    turn?: RoutedCoachTurn,
  ): void {
    if (
      !this.active ||
      !shouldAcceptTurnEvent(
        {
          turnId,
          speechEpoch: this.speechEpoch,
          stateVersion: this.stateVersion,
        },
        {
          turnId: event.turn_id,
          speechEpoch,
          stateVersion: "state_version" in event ? event.state_version : undefined,
        }
      )
    ) {
      return;
    }
    if ("state_version" in event) this.stateVersion = event.state_version;
    if (event.type === "turn_started") {
      this.model = event.model;
      this.stateFingerprint = event.state_fingerprint;
      return;
    }
    if (event.type === "text_delta") {
      if (turn && turn.providerFirstDeltaAt == null) {
        turn.providerFirstDeltaAt = Date.now();
        this.logVoiceMetric(turn, "first_provider_delta");
      }
      this.ttsInputBuffer += event.delta;
      this.flushSonicText(false, turn);
      return;
    }
    if (event.type === "tool_result") {
      if (event.client_action && typeof event.client_action === "object") {
        let action = event.client_action as ClientTimerAction;
        if (action.type === "get_timer_status") {
          const reply = this.timerStatusReply();
          this.lastDeterministicReply = reply;
          this.callbacks?.onCoachTranscript?.(reply);
          void this.speakDeterministic(reply, event.turn_id, speechEpoch);
        }
        if (
          action.type === "start_timer" &&
          (!action.timer_exercise_id || !action.timer_set_number)
        ) {
          const current = this.currentSetState();
          const currentDrill = this.currentDrill();
          if (
            current &&
            currentDrill &&
            (
              (current.target.minutes ?? currentDrill.target.minutes ?? 0) > 0 ||
              ["ball_handling", "defense", "conditioning"].includes(
                currentDrill.category ?? ""
              )
            )
          ) {
            action = {
              ...action,
              timer_exercise_id: current.exercise_id,
              timer_set_number: current.set_number,
            };
          }
        }
        if (
          ["start_timer", "pause_timer", "resume_timer", "stop_timer"].includes(action.type)
        ) {
          this.callbacks?.onTimerAction(action);
        }
      }
      this.updateWorkoutState(event.workout_context);
      if (event.db_changed) emitWorkoutUpdated("coach");
      return;
    }
    if (event.type === "turn_completed") {
      this.stateFingerprint = event.state_fingerprint;
      this.updateWorkoutState(event.workout_context);
      if (event.daily_usage) {
        this.dailySpentBaseline = event.daily_usage.spent_usd;
        this.dailyBudgetUsd = event.daily_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(
          event.daily_usage.spent_usd,
          event.daily_usage.budget_usd,
        );
      }
      this.flushSonicText(true, turn);
      return;
    }
    if (event.type === "error") throw new Error(event.error);
  }

  private async promoteCartesiaSpeculation(
    speculation: SpeculativeCoachTurn,
    turn: RoutedCoachTurn
  ): Promise<void> {
    const speechEpoch = turn.speechEpoch;
    if (
      speculation.controller.signal.aborted ||
      speechEpoch !== this.speechEpoch ||
      speculation.stateVersion !== this.stateVersion
    ) {
      speculation.controller.abort();
      await this.requestCartesiaModelTurn(turn.transcript, turn);
      return;
    }

    this.turnAbortController?.abort();
    this.turnAbortController = speculation.controller;
    this.ttsInputBuffer = "";
    this.ttsSafetyBlocked = false;
    this.replayableSonicSpeech = null;
    this.sonicAudioEnqueuedEpoch = null;
    this.generationActive = true;
    this.updateStatus();
    let context: CartesiaSonicContext | null = null;
    try {
      context = this.createSonicContext(speechEpoch, turn);
      speculation.routedTurn = turn;
      speculation.promoted = true;
      for (const event of [...speculation.events]) {
        this.applyCartesiaTurnEvent(event, speculation.turnId, speechEpoch, turn);
      }
      await speculation.promise;
      if (speculation.error) throw speculation.error;
      if (speechEpoch !== this.speechEpoch) return;

      if (speculation.responseText.trim()) {
        const responseGate = gateCoachSpeechText(speculation.responseText.trim(), true);
        if (responseGate.status === "safe") {
          this.conversationSummary = appendConversationTurn(
            this.conversationSummary,
            turn.transcript,
            responseGate.speech,
          );
          this.callbacks?.onConversationSummary?.(this.conversationSummary);
        }
      }
      turn.backendCompletedAt = Date.now();
      this.logVoiceMetric(turn, "backend_complete");
    } catch (error) {
      const aborted =
        speculation.controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      if (!aborted && speechEpoch === this.speechEpoch) throw error;
      try {
        context?.cancel();
      } catch {
        // Already completed.
      }
    } finally {
      if (this.turnAbortController === speculation.controller) {
        this.turnAbortController = null;
      }
      if (speechEpoch === this.speechEpoch) {
        this.generationActive = false;
        this.updateStatus();
      }
      void this.reportCartesiaUsage(false);
    }
  }

  private async requestCartesiaModelTurn(
    transcript: string,
    turn: RoutedCoachTurn
  ): Promise<void> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey) throw new Error("Coach session is not active.");
    const speechEpoch = turn.speechEpoch;
    this.generationActive = true;
    this.updateStatus();
    if (speechEpoch !== this.speechEpoch) return;
    const controller = new AbortController();
    this.turnAbortController?.abort();
    this.turnAbortController = controller;
    this.ttsInputBuffer = "";
    this.ttsSafetyBlocked = false;
    this.replayableSonicSpeech = null;
    this.sonicAudioEnqueuedEpoch = null;
    let context: CartesiaSonicContext | null = null;
    let responseText = "";
    try {
      context = this.createSonicContext(speechEpoch, turn);
      await streamCoachTurn({
        dayId,
        sessionKey,
        turnId: turn.requestId,
        transcript,
        stateVersion: this.stateVersion,
        conversationSummary: this.conversationSummary,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "text_delta") responseText += event.delta;
          this.applyCartesiaTurnEvent(event, turn.requestId, speechEpoch, turn);
        },
      });
      if (speechEpoch !== this.speechEpoch) return;
      if (responseText.trim()) {
        const responseGate = gateCoachSpeechText(responseText.trim(), true);
        if (responseGate.status === "safe") {
          this.conversationSummary = appendConversationTurn(
            this.conversationSummary,
            transcript,
            responseGate.speech,
          );
          this.callbacks?.onConversationSummary?.(this.conversationSummary);
        }
      }
      turn.backendCompletedAt = Date.now();
      this.logVoiceMetric(turn, "backend_complete");
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      if (!aborted) {
        try {
          context?.cancel();
        } catch {
          // The provider may have already closed the failed context.
        }
        throw error;
      }
      try {
        context?.cancel();
      } catch {
        // Already completed.
      }
    } finally {
      if (this.turnAbortController === controller) this.turnAbortController = null;
      if (speechEpoch === this.speechEpoch) {
        this.generationActive = false;
        this.updateStatus();
      }
      void this.reportCartesiaUsage(false);
    }
  }

  private async reportCartesiaUsage(force: boolean): Promise<void> {
    if (this.providerUsagePromise) {
      if (!force) return;
      await this.providerUsagePromise;
    }
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!this.cartesiaActive || !dayId || !sessionKey) return;
    let usage = this.pendingCartesiaUsage;
    if (!usage) {
      const sttDelta = Math.max(0, this.cartesiaSttSeconds - this.reportedSttSeconds);
      const ttsDelta = Math.max(0, this.cartesiaTtsCharacters - this.reportedTtsCharacters);
      if (!force && sttDelta < 15 && ttsDelta < 300) return;
      if (sttDelta <= 0 && ttsDelta <= 0) return;
      usage = createProviderUsageDelta("cartesia", ++this.providerUsageSequence, {
        sttSeconds: Math.round(sttDelta * 1000) / 1000,
        ttsCharacters: Math.round(ttsDelta),
      });
      this.pendingCartesiaUsage = usage;
    }
    this.providerUsagePromise = (async () => {
      const { data, error } = await supabase.functions.invoke<{
        daily_usage?: {
          spent_usd: number;
          budget_usd: number;
          remaining_usd: number;
        };
        error?: string;
      }>("coach-provider-usage", {
        body: {
          day_id: dayId,
          session_key: sessionKey,
          request_id: usage.requestId,
          stt_audio_seconds: usage.sttSeconds ?? 0,
          tts_characters: usage.ttsCharacters ?? 0,
        },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      this.reportedSttSeconds += usage.sttSeconds ?? 0;
      this.reportedTtsCharacters += usage.ttsCharacters ?? 0;
      this.pendingCartesiaUsage = null;
      if (data?.daily_usage) {
        this.dailySpentBaseline = data.daily_usage.spent_usd;
        this.dailyBudgetUsd = data.daily_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(
          data.daily_usage.spent_usd,
          data.daily_usage.budget_usd
        );
        if (data.daily_usage.remaining_usd <= 0 && this.active) {
          this.callbacks?.onError(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
          void this.disconnect("daily_budget");
        }
      }
    })()
      .catch((error) => {
        console.warn("Failed to persist Cartesia usage:", error);
      })
      .finally(() => {
        this.providerUsagePromise = null;
      });
    await this.providerUsagePromise;
  }

  private async reportAssemblyInworldUsage(force: boolean): Promise<void> {
    // Timer ticks, model-turn completion, and disconnect can overlap. Only
    // one frozen delta may be in flight so they cannot all charge the same
    // elapsed provider time.
    if (this.providerUsagePromise) {
      if (!force) return;
      await this.providerUsagePromise;
    }
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!this.assemblyInworldActive || !dayId || !sessionKey || !this.assemblySessionStartedAt) return;
    let usage = this.pendingAssemblyInworldUsage;
    if (!usage) {
      const sessionSeconds = Math.max(
        0,
        (Date.now() - this.assemblySessionStartedAt) / 1000 -
          this.reportedAssemblySessionSeconds,
      );
      const ttsCharacters = Math.max(
        0,
        this.inworldTtsCharacters - this.reportedInworldTtsCharacters,
      );
      if (!force && sessionSeconds < 15 && ttsCharacters < 300) return;
      if (sessionSeconds <= 0 && ttsCharacters <= 0) return;
      usage = createProviderUsageDelta("assembly-inworld", ++this.providerUsageSequence, {
        assemblySessionSeconds: Math.round(sessionSeconds * 1000) / 1000,
        inworldTtsCharacters: Math.round(ttsCharacters),
      });
      this.pendingAssemblyInworldUsage = usage;
    }
    this.providerUsagePromise = (async () => {
      const { data, error } = await supabase.functions.invoke<{
        daily_usage?: { spent_usd: number; budget_usd: number; remaining_usd: number };
        error?: string;
      }>("coach-provider-usage", {
        body: {
          day_id: dayId,
          session_key: sessionKey,
          request_id: usage.requestId,
          provider: "assembly_inworld",
          assembly_session_seconds: usage.assemblySessionSeconds ?? 0,
          inworld_tts_characters: usage.inworldTtsCharacters ?? 0,
        },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      this.reportedAssemblySessionSeconds += usage.assemblySessionSeconds ?? 0;
      this.reportedInworldTtsCharacters += usage.inworldTtsCharacters ?? 0;
      this.pendingAssemblyInworldUsage = null;
      if (data?.daily_usage) {
        this.dailySpentBaseline = data.daily_usage.spent_usd;
        this.dailyBudgetUsd = data.daily_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(data.daily_usage.spent_usd, data.daily_usage.budget_usd);
        if (data.daily_usage.remaining_usd <= 0 && this.active) {
          this.callbacks?.onError(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
          void this.disconnect("daily_budget");
        }
      }
    })()
      .catch((error) => {
        // Retain the frozen delta and its request ID. A later timer tick or
        // forced disconnect retry is safe even if the server committed before
        // the original response was lost.
        console.warn("Failed to persist AssemblyAI/Inworld usage:", error);
      })
      .finally(() => {
        this.providerUsagePromise = null;
      });
    await this.providerUsagePromise;
  }

  private async speakDeterministic(
    text: string,
    _requestId: string,
    speechEpoch: number
  ): Promise<void> {
    if (speechEpoch !== this.speechEpoch || !this.active) return;
    this.lastDeterministicReply = text;
    if (this.assemblyInworldActive) {
      const progress = parseShotProgressReply(text);
      const persona = this.voicePersona;
      if (progress && persona) {
        this.stopLocalShotPlayback?.();
        this.stopLocalShotPlayback = null;
        this.generationActive = false;
        this.playbackActive = true;
        this.lastAssemblyCoachSpeech = text;
        this.assemblyClient?.updateAgentContext(text);
        this.updateStatus();
        const stop = playShotProgressAudio(persona, progress, () => {
          if (speechEpoch !== this.speechEpoch) return;
          this.stopLocalShotPlayback = null;
          this.playbackActive = false;
          this.assemblyEchoGuardUntil = 0;
          this.callbacks?.onCoachPlaybackFinished?.();
          this.updateStatus();
        });
        if (stop) {
          this.stopLocalShotPlayback = stop;
          return;
        }
        this.playbackActive = false;
      }
    }
    if (this.cartesiaActive) {
      const speechGate = gateCoachSpeechText(text, true);
      if (speechGate.status !== "safe") return;
      const speech = speechGate.speech;
      if (!speech.trim()) return;
      this.ttsInputBuffer = "";
      this.ttsSafetyBlocked = false;
      this.generationActive = true;
      this.updateStatus();
      const context = this.createSonicContext(speechEpoch);
      this.replayableSonicSpeech = {
        text: speech,
        speechEpoch,
        retried: false,
      };
      this.sonicAudioEnqueuedEpoch = null;
      this.cartesiaTtsCharacters += speech.length;
      context.finish(speech);
      return;
    }
    if (this.assemblyInworldActive) {
      const speechGate = gateCoachSpeechText(text, true);
      if (speechGate.status !== "safe") return;
      await this.speakInworldText(speechGate.speech, speechEpoch);
      return;
    }
    this.requestResponse(`Say exactly: ${JSON.stringify(text)}`, true);
  }

  private requestResponse(
    instructions: string | null,
    outOfBand = false,
    itemId: string | null = null,
    sourceTranscript: string | null = null
  ): void {
    this.responseQueue.push({
      instructions,
      outOfBand,
      itemId,
      sourceTranscript,
      speechEpoch: this.speechEpoch,
    });
    this.flushQueuedResponse();
  }

  private flushQueuedResponse(): void {
    if (
      this.responseQueue.length === 0 ||
      this.generationActive ||
      this.playbackActive ||
      this.responseCreatePending ||
      this.toolBusy ||
      !this.active
    ) {
      return;
    }
    const queued = this.responseQueue.shift();
    if (!queued) return;
    const { instructions, outOfBand, itemId } = queued;
    const responseInstructions = instructions ? { instructions } : {};
    const sent = this.sendEvent(
      {
        type: "response.create",
        response: outOfBand || itemId
          ? {
              ...responseInstructions,
              conversation: "none",
              input: itemId ? [{ type: "item_reference", id: itemId }] : [],
              ...(outOfBand ? { tool_choice: "none", tools: [] } : {}),
            }
          : responseInstructions,
      },
      false
    );
    if (!sent) {
      this.responseQueue.unshift(queued);
      return;
    }
    this.pendingResponseTranscript = queued.sourceTranscript;
    this.pendingResponseEpoch = queued.speechEpoch;
    this.responseCreatePending = true;
    this.updateStatus();
    if (this.responseCreateTimeout) clearTimeout(this.responseCreateTimeout);
    this.responseCreateTimeout = setTimeout(() => {
      if (!this.responseCreatePending) return;
      this.responseCreatePending = false;
      this.callbacks?.onError("Coach response timed out. Please try again.");
      this.updateStatus();
    }, 8_000);
  }

  private processServerEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.updateStatus();
        break;

      case "input_audio_buffer.speech_started": {
        // VAD is transport state only. Adding synthetic user messages or
        // racing a session.update here makes an automatic VAD response see
        // conflicting instructions and can trigger state-check loops.
        this.latestUserTranscript = null;
        this.speechEpoch += 1;
        this.responseQueue = [];
        if (this.generationActive || this.responseCreatePending) {
          this.sendEvent({ type: "response.cancel" }, false);
        }
        if (this.playbackActive) {
          this.sendEvent({ type: "output_audio_buffer.clear" }, false);
        }
        this.callbacks?.onStatus("listening");
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        const itemId = typeof event.item_id === "string" ? event.item_id : null;
        if (itemId) this.speechStoppedAtByItem.set(itemId, Date.now());
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
        const itemId = typeof event.item_id === "string" ? event.item_id : null;
        const generation = this.connectionGeneration;
        if (!transcript) break;
        this.transcriptRouteQueue = this.transcriptRouteQueue
          .then(() => this.routeTranscribedTurn(transcript, itemId, generation))
          .catch((err) => {
            console.error("Failed to route coach transcript:", err);
          });
        break;
      }

      case "conversation.item.input_audio_transcription.failed":
        this.latestUserTranscript = null;
        this.requestResponse(null);
        break;

      case "response.created": {
        const response = event.response as { id?: string } | undefined;
        this.generationActive = true;
        this.activeResponseId = response?.id ?? null;
        if (response?.id) {
          if (this.pendingResponseTranscript) {
            this.responseTranscripts.set(response.id, this.pendingResponseTranscript);
          }
          this.responseEpochs.set(response.id, this.pendingResponseEpoch);
        }
        this.pendingResponseTranscript = null;
        this.responseCreatePending = false;
        if (this.responseCreateTimeout) clearTimeout(this.responseCreateTimeout);
        this.responseCreateTimeout = null;
        this.updateStatus();
        break;
      }

      case "response.done": {
        const generation = this.connectionGeneration;
        this.responseDoneQueue = this.responseDoneQueue
          .then(async () => {
            if (generation === this.connectionGeneration) {
              await this.handleResponseDone(event, generation);
            }
          })
          .catch((err) => {
            console.error("Failed to process coach response:", err);
          });
        break;
      }

      case "response.cancelled":
        if (this.activeResponseId) {
          this.responseTranscripts.delete(this.activeResponseId);
          this.responseEpochs.delete(this.activeResponseId);
        }
        this.generationActive = false;
        this.activeResponseId = null;
        this.updateStatus();
        this.flushQueuedResponse();
        break;

      case "output_audio_buffer.started":
        this.playbackActive = true;
        this.updateStatus();
        break;

      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.playbackActive = false;
        this.updateStatus();
        this.flushPendingContextRefresh();
        this.flushQueuedResponse();
        break;

      case "error": {
        console.error("Realtime API error:", event);
        this.responseCreatePending = false;
        if (this.responseCreateTimeout) clearTimeout(this.responseCreateTimeout);
        this.responseCreateTimeout = null;
        const error = event.error as { message?: string } | undefined;
        this.callbacks?.onError(error?.message ?? "Realtime coach request failed.");
        this.updateStatus();
        this.flushQueuedResponse();
        break;
      }
    }
  }

  private async handleResponseDone(event: {
    type: string;
    response?: {
      id?: string;
      status?: string;
      status_details?: { reason?: string; error?: { message?: string } };
      output?: FunctionCallItem[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: {
          text_tokens?: number;
          audio_tokens?: number;
          cached_tokens?: number;
        };
        output_token_details?: {
          text_tokens?: number;
          audio_tokens?: number;
        };
      };
    };
  }, generation: number): Promise<void> {
    const response = event.response;
    if (!this.activeResponseId || response?.id === this.activeResponseId) {
      this.generationActive = false;
      this.activeResponseId = null;
    }
    if (response?.status === "failed" || response?.status_details?.error?.message) {
      this.callbacks?.onError(
        response.status_details?.error?.message ?? "Coach could not finish that response."
      );
    }
    this.usageTracker?.addResponseUsage(event.response?.usage);
    const totals = this.usageTracker?.snapshot() ?? {
      model: this.model,
      responseCount: 0,
      sessionDurationMs: 0,
      inputTextTokens: 0,
      cachedTextTokens: 0,
      cachedAudioTokens: 0,
      inputAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 0,
      estimatedCostUsd: 0,
    };
    this.callbacks?.onUsage?.(totals);

    const sessionKey = this.sessionKey;
    if (sessionKey) {
      // Do not put usage persistence on the spoken-response critical path.
      // Totals are cumulative, so later writes and disconnect safely reconcile it.
      void logCoachUsage({ dayId: this.dayId, sessionKey, totals }).then((daily) => {
        if (!daily) {
          console.warn("Coach usage persistence delayed; it will retry.");
          return;
        }
        this.dailyBudgetUsd = daily.budgetUsd;
        this.callbacks?.onBudgetUpdate?.(daily.spentUsd, daily.budgetUsd);
        if (daily.remainingUsd <= 0) {
          this.callbacks?.onError(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
          void this.disconnect("daily_budget");
        }
      });
    }
    const responseId = response?.id;
    const correlatedTranscript = responseId
      ? this.responseTranscripts.get(responseId) ?? null
      : null;
    const responseEpoch = responseId
      ? this.responseEpochs.get(responseId) ?? this.speechEpoch
      : this.speechEpoch;
    if (responseId) {
      this.responseTranscripts.delete(responseId);
      this.responseEpochs.delete(responseId);
    }
    const output = event.response?.output ?? [];
    const functionCalls = output.filter(
      (item): item is FunctionCallItem => item.type === "function_call"
    );
    const transcriptShot = parseSpokenShotCount(
      correlatedTranscript ?? this.latestUserTranscript
    );
    this.latestUserTranscript = null;

    if (functionCalls.length > 0) {
      if (responseEpoch !== this.speechEpoch) {
        this.updateStatus();
        this.flushQueuedResponse();
        return;
      }
      this.toolBusy = true;
      this.updateStatus();
      let strongestResult: ToolExecutionKind = "read_only";
      const singleShotCalls = new Set<string>();
      let transcriptShotHandled = false;
      try {
        for (const call of functionCalls) {
          let effectiveCall = call;
          if (transcriptShot && LOCAL_SHOT_TOOLS.has(call.name)) {
            if (transcriptShotHandled) {
              this.sendEvent({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: call.call_id,
                  output: "Additional shot call ignored; the transcript was already counted once.",
                },
              });
              continue;
            }
            let originalArgs: Record<string, unknown> = {};
            try {
              originalArgs = JSON.parse(call.arguments || "{}");
            } catch {
              originalArgs = {};
            }
            const name = transcriptShot.made
              ? transcriptShot.count === 1
                ? "record_make"
                : "record_makes"
              : transcriptShot.count === 1
                ? "record_miss"
                : "record_misses";
            effectiveCall = {
              ...call,
              name,
              arguments: JSON.stringify({
                exercise_id: originalArgs.exercise_id,
                drill_name: originalArgs.drill_name,
                set_number: originalArgs.set_number,
                ...(transcriptShot.count > 1 ? { count: transcriptShot.count } : {}),
              }),
            };
            transcriptShotHandled = true;
          }
          if (
            DETERMINISTIC_SHOT_TOOLS.has(effectiveCall.name) &&
            singleShotCalls.has(effectiveCall.name)
          ) {
            this.sendEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: call.call_id,
                output: "Duplicate single-shot call ignored; progress is unchanged.",
              },
            });
            continue;
          }
          if (DETERMINISTIC_SHOT_TOOLS.has(effectiveCall.name)) {
            singleShotCalls.add(effectiveCall.name);
          }
          const result = await this.executeToolCall(effectiveCall, generation);
          if (result === "completed_shot") strongestResult = "completed_shot";
          else if (result === "mutation" && strongestResult !== "completed_shot") {
            strongestResult = "mutation";
          } else if (result === "buffered_shot" && strongestResult === "read_only") {
            strongestResult = "buffered_shot";
          }
        }
      } finally {
        if (generation === this.connectionGeneration) {
          this.toolBusy = false;
          this.updateStatus();
        }
      }
      if (generation !== this.connectionGeneration) return;
      this.requestResponse(
        strongestResult === "buffered_shot"
          ? this.exactBufferedShotReply
            ? `Say only this exact sentence verbatim. Output no acknowledgment, encouragement, praise, reaction, or any other words before or after it: ${JSON.stringify(
                this.exactBufferedShotReply
              )}`
            : "Reply with only the short progress result. Do not calculate any numbers yourself."
          : strongestResult === "completed_shot"
            ? this.exactCompletedShotReply
              ? `Repeat this exact sentence verbatim without recalculating, changing the next item, or skipping a set: ${JSON.stringify(
                  this.exactCompletedShotReply
                )}`
              : "Say the set was saved and direct the athlete to the authoritative next work item."
            : strongestResult === "mutation"
              ? "State only the completed result in one short sentence. No acknowledgment, praise, preamble, action narration, offer, or closing sentence. Never mention tools, internal state, context, JSON, or refreshes. Do not call another tool unless genuinely ambiguous."
              : "Continue the athlete's request from the lookup result. If an already approved action needs another tool, call it silently without another status sentence; otherwise give only the brief answer. Never mention tools, internal state, context, JSON, or refreshes.",
        strongestResult === "buffered_shot" || strongestResult === "completed_shot"
      );
      this.exactBufferedShotReply = null;
      this.exactCompletedShotReply = null;
      return;
    }

    this.updateStatus();
    this.flushPendingContextRefresh();
    this.flushQueuedResponse();
  }

  private async executeToolCall(
    call: FunctionCallItem,
    generation: number
  ): Promise<ToolExecutionKind> {
    const dayId = this.dayId;
    const sessionKey = this.sessionKey;
    if (!dayId || !sessionKey || generation !== this.connectionGeneration) return "read_only";
    if (this.handledToolCalls.has(call.call_id)) return "read_only";
    this.handledToolCalls.add(call.call_id);

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      args = {};
    }

    try {
      let kind: ToolExecutionKind;
      let output: string;
      let summary: string;
      if (LOCAL_SHOT_TOOLS.has(call.name)) {
        const buffered = await this.bufferShootingResult(
          this.normalizedShotArguments(call.name, args)
        );
        if (buffered.kind === "buffered_shot") {
          this.exactBufferedShotReply = buffered.output;
        } else if (buffered.kind === "completed_shot") {
          this.exactCompletedShotReply = buffered.output;
        }
        kind = buffered.kind;
        output = buffered.output;
        summary = buffered.output;
      } else {
        const bufferedProgress =
          ["get_workout_position", "get_next_drill", "get_progress"].includes(call.name)
            ? this.bufferedProgressOutput()
            : null;
        if (bufferedProgress) {
          kind = "read_only";
          output = bufferedProgress;
          summary = bufferedProgress;
        } else if (call.name === "get_timer_status") {
          kind = "read_only";
          output = this.timerStatusReply();
          summary = output;
        } else if (call.name === "pause_timer" || call.name === "resume_timer") {
          const timer = this.currentTimerSnapshot();
          const hasTimer = timer.running ||
            timer.elapsed_seconds > 0 ||
            timer.duration_seconds != null;
          const canPause = call.name === "pause_timer" && timer.running;
          const canResume = call.name === "resume_timer" && !timer.running &&
            timer.elapsed_seconds > 0;
          if (!hasTimer) {
            kind = "read_only";
            output = call.name === "pause_timer"
              ? "You can't pause the timer because no timer is running."
              : "You can't resume the timer because no timer is running.";
            summary = output;
          } else if (!canPause && !canResume) {
            kind = "read_only";
            output = call.name === "pause_timer"
              ? "The timer is already paused."
              : "The timer is already running.";
            summary = output;
          } else {
            const data = await this.invokeCoachTool(call.name, args);
            kind = data.tool_kind === "read_only" ? "read_only" : "mutation";
            output = data.updated_context
              ? `${data.result}\n\nAuthoritative workout state after this call: ${data.updated_context}`
              : data.result;
            summary = data.result;
          }
        } else {
          if (FLUSH_BEFORE_TOOLS.has(call.name)) {
            await this.flushPendingShotSets();
          }
          const data = await this.invokeCoachTool(call.name, args);
          kind = data.tool_kind === "read_only" ? "read_only" : "mutation";
          output = data.updated_context
            ? `${data.result}\n\nAuthoritative workout state after this call: ${data.updated_context}`
            : data.result;
          summary = data.result;
        }
      }

      if (generation !== this.connectionGeneration) return "read_only";

      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output,
        },
      });

      if (summary) {
        this.conversationSummary = appendConversationSummary(
          this.conversationSummary,
          summary
        );
        this.callbacks?.onConversationSummary?.(this.conversationSummary);
      }

      return kind;
    } catch (err) {
      console.error(`Tool ${call.name} failed:`, err);
      if (generation !== this.connectionGeneration) return "read_only";
      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output: `Error: ${err instanceof Error ? err.message : "tool failed"}`,
        },
      });
      return "mutation";
    }
  }
}
