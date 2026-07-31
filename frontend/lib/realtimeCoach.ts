// Always-on OpenAI Realtime coach session while the overlay is open.

import { emitWorkoutUpdated } from "@/lib/coachEvents";
import {
  appendConversationSummary,
  COACH_LIMIT_MESSAGES,
  createClientRequestId,
  createSessionKey,
  createUsageTracker,
  isCoachLimitMessage,
  logCoachUsage,
} from "@/lib/coachUsage";
import { supabase } from "@/lib/supabase";
import { isLikelyNetworkError, reportNetworkFailure } from "@/lib/connectivity";
import {
  inferVoiceAudioProfile,
  startVoiceCallAudio,
  stopVoiceCallAudio,
} from "@/lib/webrtcAudio";

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
}

export interface ClientTimerAction {
  type: "start_timer" | "pause_timer" | "resume_timer" | "stop_timer";
  duration_seconds?: number | null;
  timer_exercise_id?: string | null;
  timer_set_number?: number | null;
}

export interface RealtimeCoachCallbacks {
  onStatus: (status: RealtimeCoachStatus) => void;
  onError: (message: string) => void;
  onTimerAction: (action: ClientTimerAction) => void;
  onConversationSummary?: (summary: string) => void;
  onUsage?: (totals: ReturnType<ReturnType<typeof createUsageTracker>["snapshot"]>) => void;
  onBudgetUpdate?: (spentUsd: number, budgetUsd: number) => void;
  onSessionEnded?: (reason: string) => void;
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

interface RealtimeSetResult {
  set_number: number;
  makes: number | null;
  attempts: number | null;
  completed: boolean;
  side_label?: string | null;
  progress?: { makes: number; attempts: number; misses: number };
  target?: { makes: number | null; attempts: number | null };
  remaining?: { makes: number | null; attempts: number | null };
}

interface RealtimeDrillState {
  exercise_id: string;
  name: string | null;
  target: {
    makes: number | null;
    attempts: number | null;
  };
  sets: {
    next_unfinished: number | null;
  };
  set_results: RealtimeSetResult[];
}

interface RealtimeWorkoutState {
  sequence?: { drills?: RealtimeDrillState[] };
  navigation?: {
    next_work_item?: (RealtimeDrillState & {
      set_number?: number | null;
      set_side_label?: string | null;
    }) | null;
    current_set_state?: {
      exercise_id: string;
      drill_name: string | null;
      set_number: number;
      side_label?: string | null;
      completed: boolean;
      progress: { makes: number; attempts: number; misses: number };
      target: { makes: number | null; attempts: number | null };
      remaining: { makes: number | null; attempts: number | null };
    } | null;
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
}

interface NextSetGuidance {
  drillName: string;
  setNumber: number;
  sideLabel: string | null;
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
  updated_instructions?: string | null;
  tool_kind?: "read_only" | "mutation";
  requires_spoken_confirmation?: boolean;
  error?: string;
}

const FLUSH_BEFORE_TOOLS = new Set([
  "set_current_drill",
  "skip_drill",
  "complete_drill",
  "set_set_completion",
  "finish_workout",
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
  private queuedResponseInstruction: string | null = null;
  private pendingEvents: Record<string, unknown>[] = [];
  private responseCreateTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectGraceTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private contextRefreshPromise: Promise<void> | null = null;
  private contextRefreshPending = false;
  private responseDoneQueue: Promise<void> = Promise.resolve();
  private connectionGeneration = 0;
  private dailySpentBaseline = 0;
  private dailyBudgetUsd = 0.75;
  private usageTracker: ReturnType<typeof createUsageTracker> | null = null;
  private handledToolCalls = new Set<string>();
  private loggedUsageSessionKeys = new Set<string>();
  private workoutState: RealtimeWorkoutState | null = null;
  private pendingShotSets = new Map<string, PendingShotSet>();
  private shotFlushPromise: Promise<void> | null = null;
  private exactBufferedShotReply: string | null = null;
  private exactCompletedShotReply: string | null = null;

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
    this.dailyBudgetUsd = options?.dailyBudgetUsd ?? 0.75;

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
    this.queuedResponseInstruction = null;
    this.contextRefreshPending = false;
    this.exactBufferedShotReply = null;
    this.exactCompletedShotReply = null;
    this.usageTracker = createUsageTracker(this.model);
    callbacks.onStatus("connecting");

    try {
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

  updateTimer(timer: TimerState): void {
    this.timer = timer;
  }

  async refreshWorkoutContext(): Promise<void> {
    if (this.contextRefreshPromise) return this.contextRefreshPromise;
    if (!this.active || !this.dayId || !this.sessionKey) return;
    if (this.generationActive || this.toolBusy || this.playbackActive) {
      this.contextRefreshPending = true;
      return;
    }
    this.contextRefreshPromise = (async () => {
      const { data, error } = await supabase.functions.invoke<{
        updated_instructions?: string | null;
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
      if (data?.updated_instructions) {
        this.sendEvent({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: data.updated_instructions,
          },
        });
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
    if (toolName === "finish_workout") {
      requestArgs.timezone_offset_minutes = new Date().getTimezoneOffset();
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
    if (data.client_action) this.callbacks?.onTimerAction(data.client_action);
    // Buffered shooting writes are surfaced once when the overlay closes,
    // avoiding repeated background pulls for every flushed set.
    if (data.db_changed && toolName !== "save_shooting_results") {
      emitWorkoutUpdated("coach");
    }
    this.updateWorkoutState(data.updated_context);
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
    });
    this.pendingShotSets.delete(key);
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
    if (!Number.isInteger(reportedMakes) || reportedMakes < 0) {
      return { kind: "read_only", output: "Makes must be a whole number zero or greater." };
    }
    if (!Number.isInteger(reportedAttempts) || reportedAttempts <= 0) {
      return { kind: "read_only", output: "Attempts must be a positive whole number." };
    }
    const updateMode = args.update_mode === "increment" ? "increment" : "replace";
    const nextMakes =
      updateMode === "increment" ? baseMakes + reportedMakes : reportedMakes;
    const attemptValue = reportedAttempts;
    const nextAttempts = Math.max(
      nextMakes,
      updateMode === "increment" ? baseAttempts + attemptValue : attemptValue
    );
    const targetAttempts = drill.target.attempts;
    const completed =
      args.completed === true ||
      (targetAttempts != null && targetAttempts > 0 && nextAttempts >= targetAttempts);
    const entry: PendingShotSet = {
      exerciseId: drill.exercise_id,
      drillName: drill.name ?? "current drill",
      setNumber,
      sideLabel: saved?.side_label ?? null,
      makes: nextMakes,
      attempts: nextAttempts,
      targetMakes: drill.target.makes,
      targetAttempts,
      completed,
    };
    this.pendingShotSets.set(key, entry);
    this.updateBufferedSetInWorkoutState(entry);

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
    return {
      kind: "buffered_shot",
      output: `You're ${nextMakes} for ${nextAttempts}${
        remainingShots == null
          ? "."
          : `, ${remainingShots} shot${remainingShots === 1 ? "" : "s"} left.`
      }`,
    };
  }

  markTimerSetComplete(exerciseId: string, setNumber: number): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `The timer just ended. The athlete finished set ${setNumber} of exercise_id ${exerciseId}. Call set_set_completion with completed true for that exact set, then briefly confirm it aloud.`,
          },
        ],
      },
    });
    this.requestResponse(
      "The timer ended. Call set_set_completion for the exact set described by the latest user message, then confirm it briefly."
    );
  }

  mute(): void {
    this.muted = true;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = false;
      }
    }
    this.callbacks?.onStatus("muted" as RealtimeCoachStatus);
  }

  unmute(): void {
    this.muted = false;
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
      ++this.connectionGeneration;
      this.active = false;
      this.connecting = false;
      this.playbackActive = false;
      this.generationActive = false;
      this.activeResponseId = null;
      this.toolBusy = false;
      this.responseCreatePending = false;
      this.queuedResponseInstruction = null;
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

  private requestResponse(instructions: string): void {
    this.queuedResponseInstruction = instructions;
    this.flushQueuedResponse();
  }

  private flushQueuedResponse(): void {
    if (
      !this.queuedResponseInstruction ||
      this.generationActive ||
      this.playbackActive ||
      this.responseCreatePending ||
      this.toolBusy ||
      !this.active
    ) {
      return;
    }
    const instructions = this.queuedResponseInstruction;
    this.queuedResponseInstruction = null;
    const sent = this.sendEvent(
      {
        type: "response.create",
        response: { instructions },
      },
      false
    );
    if (!sent) {
      this.queuedResponseInstruction = instructions;
      return;
    }
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
        this.callbacks?.onStatus("listening");
        break;
      }

      case "input_audio_buffer.speech_stopped":
        break;

      case "response.created": {
        const response = event.response as { id?: string } | undefined;
        this.generationActive = true;
        this.activeResponseId = response?.id ?? null;
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
    const output = event.response?.output ?? [];
    const functionCalls = output.filter(
      (item): item is FunctionCallItem => item.type === "function_call"
    );

    if (functionCalls.length > 0) {
      this.toolBusy = true;
      this.updateStatus();
      let strongestResult: ToolExecutionKind = "read_only";
      const singleShotCalls = new Set<string>();
      try {
        for (const call of functionCalls) {
          if (
            DETERMINISTIC_SHOT_TOOLS.has(call.name) &&
            singleShotCalls.has(call.name)
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
          if (DETERMINISTIC_SHOT_TOOLS.has(call.name)) {
            singleShotCalls.add(call.name);
          }
          const result = await this.executeToolCall(call, generation);
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
              ? "Answer the athlete's latest request in one short natural sentence using the tool results. Confirm completed actions, but never mention tools, internal state, context, JSON, or refreshes. Do not call another tool unless genuinely ambiguous."
              : "Answer the athlete's latest request directly and briefly using the lookup result. Do not mention tools, internal state, context, JSON, or refreshes. Do not call another tool unless the lookup result is genuinely ambiguous."
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
      } else {
        const bufferedProgress =
          ["get_workout_position", "get_next_drill", "get_progress"].includes(call.name)
            ? this.bufferedProgressOutput()
            : null;
        if (bufferedProgress) {
          kind = "read_only";
          output = bufferedProgress;
        } else {
          if (FLUSH_BEFORE_TOOLS.has(call.name)) {
            await this.flushPendingShotSets();
          }
          const data = await this.invokeCoachTool(call.name, args);
          kind = data.tool_kind === "read_only" ? "read_only" : "mutation";
          output = data.updated_context
            ? `${data.result}\n\nAuthoritative workout state after this call: ${data.updated_context}`
            : data.result;
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

      if (output) {
        this.conversationSummary = appendConversationSummary(
          this.conversationSummary,
          output
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
