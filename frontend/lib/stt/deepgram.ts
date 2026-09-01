import type {
  StreamingSttCallbacks,
  StreamingSttClient,
  StreamingSttTurn,
} from "./types";

export const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
export const DEEPGRAM_KEYTERMS = [
  "make",
  "miss",
  "undo",
  "next",
  "next drill",
  "complete set",
  "start timer",
  "stop",
  "wait",
] as const;

export type DeepgramVadState = "IDLE_VAD" | "STREAMING_TURN";

export interface PcmFrame {
  data: string;
  frames: number;
  sampleRate: number;
}

export class LocalVadAudioGate {
  private readonly prebuffer: PcmFrame[] = [];
  private prebufferFrames = 0;
  private stateValue: DeepgramVadState = "IDLE_VAD";

  constructor(private readonly prebufferMs = 400) {}

  get state(): DeepgramVadState {
    return this.stateValue;
  }

  accept(frame: PcmFrame): PcmFrame[] {
    if (this.stateValue === "STREAMING_TURN") return [frame];
    this.prebuffer.push(frame);
    this.prebufferFrames += frame.frames;
    const maxFrames = Math.round(frame.sampleRate * this.prebufferMs / 1_000);
    while (this.prebufferFrames > maxFrames && this.prebuffer.length > 1) {
      this.prebufferFrames -= this.prebuffer.shift()?.frames ?? 0;
    }
    return [];
  }

  speechStarted(): PcmFrame[] {
    if (this.stateValue === "STREAMING_TURN") return [];
    this.stateValue = "STREAMING_TURN";
    const buffered = this.prebuffer.splice(0);
    this.prebufferFrames = 0;
    return buffered;
  }

  completeTurn(): void {
    this.stateValue = "IDLE_VAD";
    this.prebuffer.length = 0;
    this.prebufferFrames = 0;
  }

  reset(): void {
    this.completeTurn();
  }
}

type DeepgramResultMessage = {
  type?: string;
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
};

type WebSocketLike = Pick<
  WebSocket,
  "readyState" | "binaryType" | "send" | "close" | "onopen" | "onerror" | "onclose" | "onmessage"
>;

export interface DeepgramClientOptions extends StreamingSttCallbacks {
  accessToken: string;
  keyterms?: readonly string[];
  keepAliveMs?: number;
  socketFactory?: (url: string, accessToken: string) => WebSocketLike;
  onAudioSent?: (milliseconds: number) => void;
  onEmptyTurn?: () => void;
  onDuplicateTurn?: () => void;
  onFinalLatency?: (milliseconds: number) => void;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function defaultSocketFactory(url: string, accessToken: string): WebSocketLike {
  type ReactNativeWebSocket = new (
    target: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  const Socket = WebSocket as unknown as ReactNativeWebSocket;
  return new Socket(url, undefined, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function buildDeepgramStreamingUrl(
  keyterms: readonly string[] = DEEPGRAM_KEYTERMS,
): string {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en-US",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    endpointing: "600",
    smart_format: "true",
    punctuate: "true",
    vad_events: "true",
  });
  for (const keyterm of keyterms) params.append("keyterm", keyterm);
  return `${DEEPGRAM_WS_URL}?${params.toString()}`;
}

export class DeepgramRealtimeClient implements StreamingSttClient {
  private socket: WebSocketLike | null = null;
  private opened = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private finalizedSegments: string[] = [];
  private finalizedSegmentKeys = new Set<string>();
  private lastCommittedSegmentKeys = new Set<string>();
  private turnSequence = 0;
  private speechEndedAt = 0;

  constructor(private readonly options: DeepgramClientOptions) {}

  get isOpen(): boolean {
    return this.opened && this.socket?.readyState === SOCKET_OPEN;
  }

  connect(): Promise<void> {
    this.close(false);
    const socketFactory = this.options.socketFactory ?? defaultSocketFactory;
    const socket = socketFactory(
      buildDeepgramStreamingUrl(this.options.keyterms),
      this.options.accessToken,
    );
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Deepgram streaming connection timed out."));
        socket.close();
      }, 10_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        this.opened = true;
        this.startKeepAlive();
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        if (!this.opened) reject(new Error("Deepgram streaming connection failed."));
        else this.options.onError(new Error("Deepgram streaming error."));
      };
      socket.onclose = (event: { code?: number }) => {
        clearTimeout(timeout);
        const wasOpen = this.opened;
        this.opened = false;
        this.clearKeepAlive();
        if (wasOpen) {
          this.options.onClose(
            new Error(`Deepgram streaming socket closed${event.code ? ` (code ${event.code})` : ""}.`),
          );
        }
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  sendAudio(base64Pcm: string): void {
    if (!this.isOpen) return;
    this.clearKeepAlive();
    const bytes = base64ToBytes(base64Pcm);
    this.socket?.send(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    this.options.onAudioSent?.(bytes.byteLength / 2 / 16_000 * 1_000);
  }

  markSpeechEnded(at = Date.now()): void {
    this.speechEndedAt = at;
  }

  finalize(): void {
    if (this.isOpen) this.socket?.send(JSON.stringify({ type: "Finalize" }));
  }

  markIdle(): void {
    this.startKeepAlive();
  }

  close(graceful = true): void {
    const socket = this.socket;
    this.socket = null;
    this.opened = false;
    this.clearKeepAlive();
    this.resetTurn();
    if (socket && socket.readyState < SOCKET_CLOSING) {
      if (graceful && socket.readyState === SOCKET_OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      }
      socket.close();
    }
  }

  private startKeepAlive(): void {
    if (!this.isOpen || this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      if (this.isOpen) this.socket?.send(JSON.stringify({ type: "KeepAlive" }));
    }, this.options.keepAliveMs ?? 4_000);
  }

  private clearKeepAlive(): void {
    if (!this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: DeepgramResultMessage;
    try {
      message = JSON.parse(data) as DeepgramResultMessage;
    } catch {
      this.options.onError(new Error("Deepgram sent an invalid streaming event."));
      return;
    }
    this.options.onServerActivity?.();
    if (message.type === "SpeechStarted") {
      this.options.onSpeechStarted();
      return;
    }
    if (message.type !== "Results") return;

    const transcript = normalizeWhitespace(
      message.channel?.alternatives?.[0]?.transcript ?? "",
    );
    if (message.is_final && transcript) {
      const key = `${message.start ?? ""}:${transcript}`;
      if (this.lastCommittedSegmentKeys.has(key)) {
        if (message.speech_final || message.from_finalize) {
          this.options.onDuplicateTurn?.();
          this.resetTurn();
          this.markIdle();
        }
        return;
      }
      if (!this.finalizedSegmentKeys.has(key)) {
        this.finalizedSegmentKeys.add(key);
        this.finalizedSegments.push(transcript);
      }
    }

    if (!message.is_final && transcript) {
      const partial = normalizeWhitespace([...this.finalizedSegments, transcript].join(" "));
      this.options.onPartial(this.turn(partial, false));
    }

    if (!message.speech_final && !message.from_finalize) return;
    const completed = normalizeWhitespace(this.finalizedSegments.join(" "));
    if (!completed) {
      this.options.onEmptyTurn?.();
      this.resetTurn();
      this.markIdle();
      return;
    }
    this.lastCommittedSegmentKeys = new Set(this.finalizedSegmentKeys);
    const now = Date.now();
    if (this.speechEndedAt > 0) {
      this.options.onFinalLatency?.(Math.max(0, now - this.speechEndedAt));
    }
    this.options.onTurn(this.turn(completed, true));
    this.resetTurn();
    this.markIdle();
  }

  private turn(transcript: string, endOfTurn: boolean): StreamingSttTurn {
    if (endOfTurn) this.turnSequence += 1;
    return {
      turnOrder: this.turnSequence,
      transcript,
      endOfTurn,
    };
  }

  private resetTurn(): void {
    this.finalizedSegments = [];
    this.finalizedSegmentKeys.clear();
    this.speechEndedAt = 0;
  }
}
