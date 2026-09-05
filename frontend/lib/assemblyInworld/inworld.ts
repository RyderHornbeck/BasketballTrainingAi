// Persistent Inworld bidirectional TTS WebSocket adapter. Local buffering
// avoids turning model token deltas into separate audible utterances.
const MAXIMUM_UTTERANCE_WAIT_MS = 450;
// A cold Inworld stream can take several seconds to return its first PCM
// packet. A short deadline caused the startup greeting to tear down and
// reconnect repeatedly before audio had a chance to begin.
export const INITIAL_FIRST_AUDIO_TIMEOUT_MS = 8_000;
export const RETRY_FIRST_AUDIO_TIMEOUT_MS = INITIAL_FIRST_AUDIO_TIMEOUT_MS;
export const AUDIO_PROGRESS_TIMEOUT_MS = 4_000;
const INWORLD_TTS_WEBSOCKET_URL =
  "wss://api.inworld.ai/tts/v1/voice:streamBidirectional";

export interface InworldRequestIdentity {
  clientId: number;
  requestId: string;
  contextId: string;
}

let clientSequence = 0;

export class InworldFirstAudioTimeoutError extends Error {
  constructor(
    readonly contextId: string,
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(`Inworld did not return audio within ${timeoutMs}ms.`);
    this.name = "InworldFirstAudioTimeoutError";
  }
}

export class InworldAudioProgressTimeoutError extends Error {
  constructor(
    readonly contextId: string,
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(`Inworld audio stream stalled for ${timeoutMs}ms.`);
    this.name = "InworldAudioProgressTimeoutError";
  }
}

export type InworldLifecycleStage =
  | "request_started"
  | "first_audio"
  | "audio_chunk"
  | "request_completed"
  | "request_cancelled"
  | "request_error"
  | "request_stalled"
  | "socket_opened"
  | "socket_closed";

export interface InworldTtsOptions {
  accessToken: string;
  refreshAccessToken: () => Promise<string>;
  voiceId: string;
  firstAudioTimeoutMs?: number;
  audioProgressTimeoutMs?: number;
  onAudio: (base64Pcm: string, identity: InworldRequestIdentity) => void;
  onFirstAudio: (identity: InworldRequestIdentity) => void;
  onDone: (contextId: string) => void;
  onBilledCharacters: (count: number) => void;
  onError: (error: Error, identity: InworldRequestIdentity) => void;
  onClose: () => void;
  onLifecycle?: (
    stage: InworldLifecycleStage,
    identity: InworldRequestIdentity,
    detail?: Record<string, unknown>,
  ) => void;
}

interface InworldContext {
  identity: InworldRequestIdentity;
  firstAudioTimer: ReturnType<typeof setTimeout> | null;
  progressTimer: ReturnType<typeof setTimeout> | null;
  hasAudio: boolean;
  final: boolean;
  sentText: boolean;
  lastFlushCompleted: boolean;
  flushInFlight: boolean;
}

interface InworldSocketMessage {
  result?: {
    contextId?: string;
    audioChunk?: {
      audioContent?: string;
      status?: { code?: number; message?: string };
    };
    flushCompleted?: Record<string, never>;
    contextClosed?: Record<string, never>;
    status?: { code?: number; message?: string };
  };
  error?: { code?: number; message?: string };
}

type ReactNativeWebSocket = WebSocket & {
  close: (code?: number, reason?: string) => void;
};

export class InworldTtsClient {
  private socket: ReactNativeWebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pendingText = new Map<string, string>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cancelledContexts = new Set<string>();
  private readonly contexts = new Map<string, InworldContext>();
  private lifetime = 0;
  private requestSequence = 0;
  private readonly clientId = ++clientSequence;

  constructor(private readonly options: InworldTtsOptions) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    this.close();
    this.lifetime += 1;
    const lifetime = this.lifetime;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      // React Native accepts handshake headers as a third constructor argument.
      const Socket = WebSocket as unknown as new (
        url: string,
        protocols?: string | string[],
        options?: { headers?: Record<string, string> },
      ) => ReactNativeWebSocket;
      const socket = new Socket(INWORLD_TTS_WEBSOCKET_URL, undefined, {
        headers: { Authorization: `Bearer ${this.options.accessToken}` },
      });
      this.socket = socket;
      let connected = false;
      socket.onopen = () => {
        if (this.lifetime !== lifetime || this.socket !== socket) {
          socket.close();
          return;
        }
        connected = true;
        this.options.onLifecycle?.("socket_opened", this.socketIdentity(), {
          transport: "websocket",
        });
        resolve();
      };
      socket.onerror = () => {
        if (!connected && this.lifetime === lifetime && this.socket === socket) {
          this.socket = null;
          reject(new Error("Inworld TTS WebSocket connection failed."));
        }
      };
      socket.onclose = (event) => {
        if (this.lifetime !== lifetime || this.socket !== socket) return;
        this.socket = null;
        this.options.onLifecycle?.("socket_closed", this.socketIdentity(), {
          code: event.code,
          reason: event.reason,
        });
        if (!connected) {
          reject(new Error(`Inworld TTS WebSocket closed: ${event.reason || event.code}`));
          return;
        }
        for (const context of [...this.contexts.values()]) {
          this.failContext(context, `Inworld TTS WebSocket closed: ${event.reason || event.code}`);
        }
        this.options.onClose();
      };
      socket.onmessage = (event) => this.handleMessage(event.data, socket, lifetime);
    });
    return this.connectPromise;
  }

  createContext(contextId: string): void {
    this.cancelledContexts.delete(contextId);
    this.pendingText.set(contextId, "");
    const context: InworldContext = {
      identity: {
        clientId: this.clientId,
        requestId: `${this.lifetime}:${++this.requestSequence}`,
        contextId,
      },
      firstAudioTimer: null,
      progressTimer: null,
      hasAudio: false,
      final: false,
      sentText: false,
      lastFlushCompleted: false,
      flushInFlight: false,
    };
    this.contexts.set(contextId, context);
    this.send({
      create: {
        voiceId: this.options.voiceId,
        modelId: "inworld-tts-2",
        audioConfig: {
          audioEncoding: "PCM",
          sampleRateHertz: 16000,
          speakingRate: 1.08,
        },
        language: "en-US",
        deliveryMode: "BALANCED",
        maxBufferDelayMs: 0,
        bufferCharThreshold: 1000,
      },
      contextId,
    });
  }

  pushText(contextId: string, text: string, finish = false): void {
    if (!text.trim() || this.cancelledContexts.has(contextId)) return;
    this.pendingText.set(contextId, `${this.pendingText.get(contextId) ?? ""}${text}`);
    if (!finish) {
      // A completed coach response arrives as a burst followed immediately by
      // finish(). Do not split that burst by character count: sequential
      // Inworld flushes can leave the native PCM queue empty for several
      // seconds between phrases, making playback end in the middle of speech.
      // The timer still releases genuinely incremental/tool speech promptly.
      if (!this.flushTimers.has(contextId)) {
        this.flushTimers.set(
          contextId,
          setTimeout(() => this.flush(contextId, false), MAXIMUM_UTTERANCE_WAIT_MS),
        );
      }
      return;
    }
    this.flush(contextId, finish);
  }

  finish(contextId: string): void {
    if (!this.cancelledContexts.has(contextId)) this.flush(contextId, true);
  }

  cancel(contextId: string): void {
    this.cancelledContexts.add(contextId);
    const timer = this.flushTimers.get(contextId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(contextId);
    this.pendingText.delete(contextId);
    const context = this.contexts.get(contextId);
    if (context) {
      this.clearContextTimers(context);
      this.contexts.delete(contextId);
      this.options.onLifecycle?.("request_cancelled", context.identity);
    }
    if (this.isOpen) this.send({ close_context: {}, contextId });
  }

  close(): void {
    this.lifetime += 1;
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    socket?.close(1000, "Coach session closed");
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.pendingText.clear();
    this.cancelledContexts.clear();
    for (const context of this.contexts.values()) this.clearContextTimers(context);
    this.contexts.clear();
  }

  private flush(contextId: string, final: boolean): void {
    const flushTimer = this.flushTimers.get(contextId);
    if (flushTimer) clearTimeout(flushTimer);
    this.flushTimers.delete(contextId);
    const context = this.contexts.get(contextId);
    const text = this.pendingText.get(contextId)?.trim() ?? "";
    this.pendingText.set(contextId, "");
    if (!context || (!text && !final)) return;
    context.final ||= final;
    // Inworld's flushCompleted events identify only a context, not an
    // individual client flush. Its protocol guarantees sequential flush
    // completion, so keep a single flush in flight to know exactly which
    // phrase completed and prevent an earlier sentence from ending the turn.
    if (context.flushInFlight) {
      this.pendingText.set(
        contextId,
        `${text}${this.pendingText.get(contextId) ?? ""}`,
      );
      return;
    }
    if (!context.sentText && text) {
      context.sentText = true;
      const requestText = this.withSteering(text);
      this.options.onBilledCharacters(requestText.length);
      this.options.onLifecycle?.("request_started", context.identity, {
        characters: requestText.length,
        final,
        transport: "websocket",
      });
      this.scheduleFirstAudioTimeout(context);
    }
    if (!text) {
      // Do not emit an empty second flush. Inworld can synthesize the prior
      // buffered phrase again, which made optimistic pre-tool lines play
      // twice. If its previous flush already finished, the context can end
      // immediately; otherwise the incoming flushCompleted event will do it.
      if (final && context.sentText && context.lastFlushCompleted) {
        this.completeContext(context);
      }
      return;
    }
    context.lastFlushCompleted = false;
    context.flushInFlight = true;
    this.send({
      send_text: {
        text: this.withSteering(text),
        // The local 240-character / 450 ms gate is the latency/prosody
        // boundary. Flush every one of those chunks so Inworld does not hold
        // early Coach speech until its own 1,000-character threshold.
        flush_context: {},
      },
      contextId,
    });
  }

  private handleMessage(data: unknown, socket: ReactNativeWebSocket, lifetime: number): void {
    if (this.lifetime !== lifetime || this.socket !== socket || typeof data !== "string") return;
    let message: InworldSocketMessage;
    try {
      message = JSON.parse(data) as InworldSocketMessage;
    } catch {
      return;
    }
    const result = message.result;
    const contextId = result?.contextId;
    const context = contextId ? this.contexts.get(contextId) : undefined;
    if (!context) return;
    const status = message.error ?? result?.status ?? result?.audioChunk?.status;
    if (status && status.code && status.code !== 0) {
      this.failContext(context, status.message || `Inworld error ${status.code}`);
      return;
    }
    const audio = result?.audioChunk?.audioContent;
    if (audio) {
      if (!context.hasAudio) {
        context.hasAudio = true;
        this.clearFirstAudioTimeout(context);
        this.options.onFirstAudio(context.identity);
        this.options.onLifecycle?.("first_audio", context.identity, {
          bytes: base64ByteLength(audio),
        });
      }
      this.scheduleProgressTimeout(context);
      this.options.onLifecycle?.("audio_chunk", context.identity, {
        bytes: base64ByteLength(audio),
      });
      this.options.onAudio(audio, context.identity);
    }
    if (result?.flushCompleted) {
      // A WebSocket context can serve multiple independently flushed phrases:
      // e.g. "I'm searching for..." followed by the catalog options. A
      // completed non-final flush is healthy, not an audio stall.
      if (context.progressTimer) clearTimeout(context.progressTimer);
      context.progressTimer = null;
      context.flushInFlight = false;
      context.lastFlushCompleted = true;
      const pendingText = this.pendingText.get(context.identity.contextId)?.trim() ?? "";
      if (pendingText) {
        this.flush(context.identity.contextId, context.final);
      } else if (context.final) {
        this.completeContext(context);
      }
    } else if (result?.contextClosed) {
      this.completeContext(context);
    }
  }

  private scheduleFirstAudioTimeout(context: InworldContext): void {
    this.clearFirstAudioTimeout(context);
    const timeoutMs = this.options.firstAudioTimeoutMs ?? INITIAL_FIRST_AUDIO_TIMEOUT_MS;
    context.firstAudioTimer = setTimeout(() => {
      if (this.contexts.get(context.identity.contextId) !== context || context.hasAudio) return;
      this.options.onLifecycle?.("request_error", context.identity, {
        error: "first_audio_timeout",
        timeout_ms: timeoutMs,
      });
      this.options.onError(
        new InworldFirstAudioTimeoutError(
          context.identity.contextId,
          context.identity.requestId,
          timeoutMs,
        ),
        context.identity,
      );
    }, timeoutMs);
  }

  private scheduleProgressTimeout(context: InworldContext): void {
    if (context.progressTimer) clearTimeout(context.progressTimer);
    const timeoutMs = this.options.audioProgressTimeoutMs ?? AUDIO_PROGRESS_TIMEOUT_MS;
    context.progressTimer = setTimeout(() => {
      if (this.contexts.get(context.identity.contextId) !== context) return;
      this.options.onLifecycle?.("request_stalled", context.identity, { timeout_ms: timeoutMs });
      this.options.onError(
        new InworldAudioProgressTimeoutError(
          context.identity.contextId,
          context.identity.requestId,
          timeoutMs,
        ),
        context.identity,
      );
    }, timeoutMs);
  }

  private failContext(context: InworldContext, message: string): void {
    this.clearContextTimers(context);
    this.options.onLifecycle?.("request_error", context.identity, { error: message });
    this.options.onError(new Error(message), context.identity);
  }

  private completeContext(context: InworldContext): void {
    this.clearContextTimers(context);
    this.contexts.delete(context.identity.contextId);
    // flushCompleted ends synthesis but does not release the server-side
    // context. Inworld permits only five open contexts per connection, so
    // explicitly close every completed context before reusing the socket.
    if (this.isOpen) {
      this.send({
        close_context: {},
        contextId: context.identity.contextId,
      });
    }
    this.options.onLifecycle?.("request_completed", context.identity);
    if (context.final && !this.cancelledContexts.has(context.identity.contextId)) {
      this.options.onDone(context.identity.contextId);
    }
  }

  private clearFirstAudioTimeout(context: InworldContext): void {
    if (context.firstAudioTimer) clearTimeout(context.firstAudioTimer);
    context.firstAudioTimer = null;
  }

  private clearContextTimers(context: InworldContext): void {
    this.clearFirstAudioTimeout(context);
    if (context.progressTimer) clearTimeout(context.progressTimer);
    context.progressTimer = null;
  }

  private send(message: Record<string, unknown>): void {
    if (!this.isOpen) throw new Error("Inworld TTS WebSocket is not connected.");
    this.socket?.send(JSON.stringify(message));
  }

  private socketIdentity(): InworldRequestIdentity {
    return { clientId: this.clientId, requestId: `socket:${this.lifetime}`, contextId: "" };
  }

  private withSteering(text: string): string {
    return `[warm supportive basketball coach with natural conversational pacing and brief pauses between thoughts] ${text}`;
  }
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}
