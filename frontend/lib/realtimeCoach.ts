// Always-on OpenAI Realtime coach session while the overlay is open.

import { emitWorkoutUpdated } from "@/lib/coachEvents";
import {
  appendConversationSummary,
  COACH_LIMIT_MESSAGES,
  COACH_WORKOUT_BUDGET_USD,
  createClientRequestId,
  createSessionKey,
  createUsageTracker,
  isCoachLimitMessage,
  isWorkoutBudgetExhausted,
  logCoachUsage,
} from "@/lib/coachUsage";
import {
  COACH_DUPLICATE_SPEECH_MS,
  COACH_MIN_SPEECH_MS,
} from "@/lib/coachStateMachine";
import { supabase } from "@/lib/supabase";
import { startVoiceCallAudio, stopVoiceCallAudio } from "@/lib/webrtcAudio";

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
      if (body.code === "daily_response_limit") {
        return COACH_LIMIT_MESSAGES.dailyResponseLimit;
      }
      if (body.code === "workout_response_limit") {
        return COACH_LIMIT_MESSAGES.workoutResponseLimit;
      }
      if (body.code === "workout_budget_exhausted") {
        return COACH_LIMIT_MESSAGES.workoutBudgetExhausted;
      }
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
    const timeout = setTimeout(() => reject(new Error("Coach data channel timed out.")), 15000);
    const onOpen = () => {
      clearTimeout(timeout);
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
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
  private speaking = false;
  private toolBusy = false;
  private pendingResponseCreate = false;
  private speechStartedAt = 0;
  private lastSpeechEndedAt = 0;
  private lastCoachAudioEnd = 0;
  private disconnectReason = "manual";
  private workoutSpentBaseline = 0;
  private workoutBudgetUsd = COACH_WORKOUT_BUDGET_USD;
  private usageTracker: ReturnType<typeof createUsageTracker> | null = null;
  private handledToolCalls = new Set<string>();
  private loggedUsageSessionKeys = new Set<string>();
  private cancelledShortSpeech = false;

  getSessionKey(): string | null {
    return this.sessionKey;
  }

  async connect(
    dayId: string,
    timer: TimerState,
    conversationSummary: string,
    callbacks: RealtimeCoachCallbacks,
    options?: { workoutSpentUsd?: number; workoutBudgetUsd?: number }
  ): Promise<void> {
    if (this.connecting) return;
    if (this.active) return;
    if (this.pc) await this.disconnect("reconnect");

    this.connecting = true;
    this.callbacks = callbacks;
    this.workoutSpentBaseline = options?.workoutSpentUsd ?? 0;
    this.workoutBudgetUsd = options?.workoutBudgetUsd ?? COACH_WORKOUT_BUDGET_USD;

    if (isWorkoutBudgetExhausted(this.workoutSpentBaseline, this.workoutBudgetUsd)) {
      this.connecting = false;
      this.callbacks.onError(COACH_LIMIT_MESSAGES.workoutBudgetExhausted);
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
    this.usageTracker = createUsageTracker(this.model);
    callbacks.onStatus("connecting");

    try {
      const audioProfile = await startVoiceCallAudio();
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
        if (e.data != null) this.handleDataChannelMessage(e.data);
      });

      pc.addEventListener("connectionstatechange", () => {
        if (!this.active) return;
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected" || state === "closed") {
          this.callbacks?.onError("Coach connection lost.");
          this.callbacks?.onStatus("error");
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
      this.localStream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = true;
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
          day_id: dayId,
          sdp: offer.sdp,
          timer,
          audio_profile: audioProfile,
          session_key: this.sessionKey,
          conversation_summary: this.conversationSummary,
        },
      });

      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data?.sdp) {
        if (data?.code === "workout_budget_exhausted") {
          throw new Error(COACH_LIMIT_MESSAGES.workoutBudgetExhausted);
        }
        if (data?.code === "daily_budget_exhausted") {
          throw new Error(COACH_LIMIT_MESSAGES.dailyBudgetExhausted);
        }
        throw new Error(data?.error ?? "No SDP answer from coach-realtime.");
      }

      if (data.workout_usage) {
        this.workoutSpentBaseline = data.workout_usage.spent_usd;
        this.workoutBudgetUsd = data.workout_usage.budget_usd;
        this.callbacks?.onBudgetUpdate?.(this.workoutSpentBaseline, this.workoutBudgetUsd);
      }

      this.model = data.model ?? this.model;
      this.usageTracker = createUsageTracker(this.model);

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
      await waitForDataChannelOpen(dc);

      if (data.workout_context) {
        this.seedWorkoutContext(data.workout_context);
      }

      this.callbacks?.onStatus("listening");
    } catch (err) {
      console.error("Realtime coach connect failed:", err);
      const msg = err instanceof Error ? err.message : "Failed to connect to coach.";
      this.callbacks?.onError(msg);
      if (isCoachLimitMessage(msg)) {
        this.callbacks?.onStatus("budget_exhausted");
      } else {
        this.callbacks?.onStatus("error");
      }
      await this.disconnect("connect_failed");
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  updateTimer(timer: TimerState): void {
    this.timer = timer;
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
    this.sendEvent({ type: "response.create" });
  }

  mute(): void {
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = false;
      }
    }
    this.callbacks?.onStatus("muted" as RealtimeCoachStatus);
  }

  unmute(): void {
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = true;
      }
    }
    this.callbacks?.onStatus(this.speaking ? "speaking" : "listening");
  }

  async disconnect(reason = "manual"): Promise<void> {
    if (!this.active && !this.connecting && !this.pc) return;

    this.disconnectReason = reason;
    this.callbacks?.onStatus("disconnecting");
    this.active = false;
    this.connecting = false;
    this.speaking = false;
    this.toolBusy = false;
    this.pendingResponseCreate = false;

    if (
      this.usageTracker &&
      this.sessionKey &&
      !this.loggedUsageSessionKeys.has(this.sessionKey)
    ) {
      this.loggedUsageSessionKeys.add(this.sessionKey);
      const totals = this.usageTracker.snapshot();
      this.callbacks?.onUsage?.(totals);
      await logCoachUsage({
        dayId: this.dayId,
        sessionKey: this.sessionKey,
        totals,
      });
    }

    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // ignore
      }
      this.dc = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }

    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) track.stop();
      this.remoteStream = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }

    await stopVoiceCallAudio();
    this.sessionKey = null;
    this.usageTracker = null;
    this.handledToolCalls.clear();

    if (reason !== "connect_failed") {
      if (reason === "workout_budget" || reason === "daily_budget") {
        this.callbacks?.onStatus("budget_exhausted");
      } else if (!this.active && !this.connecting) {
        this.callbacks?.onStatus("idle");
      }
    }
    this.callbacks?.onSessionEnded?.(reason);
  }

  private seedWorkoutContext(contextJson: string): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Today's workout data (use to answer questions — name drills when the athlete asks):\n${contextJson}`,
          },
        ],
      },
    });
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
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

  private setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (speaking) {
      this.callbacks?.onStatus("speaking");
      return;
    }
    this.lastCoachAudioEnd = Date.now();
    if (!this.toolBusy) this.callbacks?.onStatus("listening");
  }

  private maybeCancelShortSpeech(): void {
    const duration = Date.now() - this.speechStartedAt;
    if (duration > 0 && duration < COACH_MIN_SPEECH_MS) {
      this.cancelledShortSpeech = true;
      this.sendEvent({ type: "response.cancel" });
    }
  }

  private processServerEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        if (!this.speaking && !this.toolBusy) this.callbacks?.onStatus("listening");
        break;

      case "input_audio_buffer.speech_started": {
        if (this.speaking || this.toolBusy) return;
        if (Date.now() - this.lastCoachAudioEnd < 400) return;
        if (Date.now() - this.lastSpeechEndedAt < COACH_DUPLICATE_SPEECH_MS) return;
        this.speechStartedAt = Date.now();
        this.cancelledShortSpeech = false;
        this.sendTimerContext();
        this.callbacks?.onStatus("listening");
        break;
      }

      case "input_audio_buffer.speech_stopped":
        this.lastSpeechEndedAt = Date.now();
        this.maybeCancelShortSpeech();
        break;

      case "response.created":
        if (this.cancelledShortSpeech) return;
        this.callbacks?.onStatus("thinking");
        this.setSpeaking(true);
        break;

      case "response.done":
        void this.handleResponseDone(event);
        break;

      case "response.cancelled":
        this.setSpeaking(false);
        break;

      case "output_audio_buffer.started":
        if (!this.cancelledShortSpeech) this.setSpeaking(true);
        break;

      case "output_audio_buffer.stopped":
        this.setSpeaking(false);
        break;

      case "error":
        console.error("Realtime API error:", event);
        break;
    }
  }

  private sendTimerContext(): void {
    if (!this.timer.running || !this.timer.duration_seconds) return;
    const remainingSeconds = Math.max(
      0,
      Math.ceil(this.timer.duration_seconds - this.timer.elapsed_seconds)
    );
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Timer context: ${remainingSeconds} seconds remain on the active workout timer.`,
          },
        ],
      },
    });
  }

  private async handleResponseDone(event: {
    type: string;
    response?: {
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
  }): Promise<void> {
    if (this.cancelledShortSpeech) {
      this.cancelledShortSpeech = false;
      this.setSpeaking(false);
      return;
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

    const totalSpentUsd = this.workoutSpentBaseline + totals.estimatedCostUsd;
    this.callbacks?.onBudgetUpdate?.(totalSpentUsd, this.workoutBudgetUsd);
    if (isWorkoutBudgetExhausted(totalSpentUsd, this.workoutBudgetUsd)) {
      this.callbacks?.onError(COACH_LIMIT_MESSAGES.workoutBudgetExhausted);
      void this.disconnect("workout_budget");
      return;
    }

    const output = event.response?.output ?? [];
    const functionCalls = output.filter(
      (item): item is FunctionCallItem => item.type === "function_call"
    );

    if (functionCalls.length > 0) {
      this.toolBusy = true;
      try {
        for (const call of functionCalls) {
          await this.executeToolCall(call);
        }
      } finally {
        this.toolBusy = false;
        this.setSpeaking(false);
      }
      return;
    }

    this.setSpeaking(false);
  }

  private async executeToolCall(call: FunctionCallItem): Promise<void> {
    if (!this.dayId || !this.sessionKey) return;
    if (this.handledToolCalls.has(call.call_id)) return;
    this.handledToolCalls.add(call.call_id);

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      args = {};
    }

    if (typeof args.client_request_id !== "string") {
      args.client_request_id = createClientRequestId(call.name);
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        result: string;
        client_action: ClientTimerAction | null;
        db_changed: boolean;
        local_confirmation?: string | null;
        skip_model_response?: boolean;
        deduplicated?: boolean;
        error?: string;
      }>("coach-tools", {
        body: {
          day_id: this.dayId,
          session_key: this.sessionKey,
          tool_name: call.name,
          arguments: args,
        },
      });

      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data) throw new Error("Empty tool response.");
      if (data.error) throw new Error(data.error);

      if (data.client_action) {
        this.callbacks?.onTimerAction(data.client_action);
      }
      if (data.db_changed) {
        emitWorkoutUpdated();
      }

      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output: data.result,
        },
      });

      if (data.result) {
        this.conversationSummary = appendConversationSummary(
          this.conversationSummary,
          data.result
        );
        this.callbacks?.onConversationSummary?.(this.conversationSummary);
      }

      if (!data.skip_model_response && !this.pendingResponseCreate) {
        this.pendingResponseCreate = true;
        await new Promise((r) => setTimeout(r, 120));
        this.sendEvent({ type: "response.create" });
        this.pendingResponseCreate = false;
      }
    } catch (err) {
      console.error(`Tool ${call.name} failed:`, err);
      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output: `Error: ${err instanceof Error ? err.message : "tool failed"}`,
        },
      });
      if (!this.pendingResponseCreate) {
        this.pendingResponseCreate = true;
        await new Promise((r) => setTimeout(r, 120));
        this.sendEvent({ type: "response.create" });
        this.pendingResponseCreate = false;
      }
    }
  }
}
