// OpenAI Realtime API WebRTC session for the voice coach.
//
// Uses react-native-webrtc (requires a dev/production build, not Expo Go).
// Audio flows directly between the mic, OpenAI, and the speaker/AirPods.
// Tool calls from the model are executed via the coach-tools Edge Function.

import { emitWorkoutUpdated } from "@/lib/coachEvents";
import { supabase } from "@/lib/supabase";

export type RealtimeCoachStatus = "connecting" | "listening" | "speaking" | "muted" | "error";

export interface TimerState {
  running: boolean;
  elapsed_seconds: number;
}

export type ClientTimerAction = "start_timer" | "pause_timer" | "resume_timer";

export interface RealtimeCoachCallbacks {
  onStatus: (status: RealtimeCoachStatus) => void;
  onError: (message: string) => void;
  onTimerAction: (action: ClientTimerAction) => void;
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

// Lazy-load WebRTC so the native module is not touched during app startup.
async function loadWebRTC() {
  try {
    const mod = await import("react-native-webrtc");
    mod.registerGlobals();
    return mod;
  } catch (err) {
    console.error("Failed to load react-native-webrtc:", err);
    throw err;
  }
}

type WebRTCModule = Awaited<ReturnType<typeof loadWebRTC>>;
type RnMediaStream = Awaited<ReturnType<WebRTCModule["mediaDevices"]["getUserMedia"]>>;

export class RealtimeCoachSession {
  // WebRTC objects come from react-native-webrtc globals; use loose typing to
  // avoid conflicts with the DOM lib.
  private pc: any = null;
  private dc: any = null;
  private localStream: RnMediaStream | null = null;
  private callbacks: RealtimeCoachCallbacks | null = null;
  private dayId: string | null = null;
  private timer: TimerState = { running: false, elapsed_seconds: 0 };
  private active = false;
  private speaking = false;

  async connect(
    dayId: string,
    timer: TimerState,
    callbacks: RealtimeCoachCallbacks
  ): Promise<void> {
    await this.disconnect();
    this.dayId = dayId;
    this.timer = timer;
    this.callbacks = callbacks;
    this.active = true;
    callbacks.onStatus("connecting");

    try {
      const webrtc = await loadWebRTC();
      const { mediaDevices, RTCPeerConnection, RTCSessionDescription } = webrtc;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
          this.callbacks?.onError("Coach connection lost. Tap to reconnect.");
          this.callbacks?.onStatus("error");
        }
      });

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      // Remote coach audio plays automatically through the WebRTC track.
      pc.addEventListener("track", () => {
        // Track attached — audio routing handled natively.
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const { data, error } = await supabase.functions.invoke<{ sdp: string; error?: string }>(
        "coach-realtime",
        {
          body: {
            day_id: dayId,
            sdp: offer.sdp,
            timer,
          },
        }
      );

      if (error) throw new Error(error.message);
      if (!data?.sdp) throw new Error(data?.error ?? "No SDP answer from coach-realtime.");

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: data.sdp })
      );

      this.callbacks?.onStatus("listening");
    } catch (err) {
      console.error("Realtime coach connect failed:", err);
      await this.disconnect();
      const msg =
        err instanceof Error ? err.message : "Failed to connect to coach.";
      const friendly = msg.includes("Cannot find module") || msg.includes("native module")
        ? "Realtime coach requires a development or production build (not Expo Go)."
        : msg;
      this.callbacks?.onError(friendly);
      this.callbacks?.onStatus("error");
      throw err;
    }
  }

  /** Mute the mic without tearing down the WebRTC session. */
  mute(): void {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.enabled = false;
      }
    }
    this.callbacks?.onStatus("muted");
  }

  /** Re-enable the mic on an existing session. */
  unmute(): void {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.enabled = true;
      }
    }
    this.callbacks?.onStatus(this.speaking ? "speaking" : "listening");
  }

  updateTimer(timer: TimerState): void {
    this.timer = timer;
  }

  async disconnect(): Promise<void> {
    this.active = false;
    this.speaking = false;

    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // Already closed.
      }
      this.dc = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Already closed.
      }
      this.pc = null;
    }
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

  private processServerEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        if (!this.speaking) this.callbacks?.onStatus("listening");
        break;

      case "input_audio_buffer.speech_started":
        // User is talking — barge-in is handled server-side.
        if (!this.speaking) this.callbacks?.onStatus("listening");
        break;

      case "response.created":
        this.speaking = true;
        this.callbacks?.onStatus("speaking");
        break;

      case "response.done":
        this.handleResponseDone(event);
        break;

      case "error":
        console.error("Realtime API error:", event);
        break;
    }
  }

  private async handleResponseDone(event: {
    type: string;
    response?: { output?: FunctionCallItem[] };
  }): Promise<void> {
    const output = event.response?.output ?? [];
    const functionCalls = output.filter(
      (item): item is FunctionCallItem => item.type === "function_call"
    );

    if (functionCalls.length > 0) {
      for (const call of functionCalls) {
        await this.executeToolCall(call);
      }
      return;
    }

    // Spoken response finished.
    this.speaking = false;
    const tracksEnabled = this.localStream?.getTracks().some((t) => t.enabled) ?? false;
    this.callbacks?.onStatus(tracksEnabled ? "listening" : "muted");
  }

  private async executeToolCall(call: FunctionCallItem): Promise<void> {
    if (!this.dayId) return;

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      // Use empty args; tool will report the error.
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        result: string;
        client_action: ClientTimerAction | null;
        db_changed: boolean;
        error?: string;
      }>("coach-tools", {
        body: {
          day_id: this.dayId,
          tool_name: call.name,
          arguments: args,
        },
      });

      if (error) throw new Error(error.message);
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
      this.sendEvent({ type: "response.create" });
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
      this.sendEvent({ type: "response.create" });
    }
  }
}
