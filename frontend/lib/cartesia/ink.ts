import {
  CARTESIA_STT_URL,
  CartesiaTransportError,
  audioToArrayBuffer,
  buildTokenWebSocketUrl,
  defaultWebSocketFactory,
  formatSocketClose,
  optionalString,
  parseJsonObject,
  requireNumber,
  requireString,
  socketIsOpen,
  type BinaryAudio,
  type WebSocketFactory,
  type WebSocketLike,
} from "./protocol";

export type InkEncoding =
  | "pcm_s16le"
  | "pcm_s32le"
  | "pcm_f16le"
  | "pcm_f32le"
  | "pcm_mulaw"
  | "pcm_alaw";

export interface InkTurnConfig {
  startThreshold?: number;
  eagerEndThreshold?: number;
  endThreshold?: number;
  endTimeoutMs?: number;
}

export interface InkClientOptions {
  accessToken: string;
  encoding: InkEncoding;
  sampleRate: number;
  keyterms?: readonly string[];
  turn?: InkTurnConfig;
  endpoint?: string;
  webSocketFactory?: WebSocketFactory;
  onConnected?: (event: InkConnectedEvent) => void;
  onTurnStart?: (event: InkTurnStartEvent) => void;
  onTurnUpdate?: (event: InkTranscriptEvent) => void;
  onTurnEagerEnd?: (event: InkTranscriptEvent) => void;
  onTurnResume?: (event: InkTurnResumeEvent) => void;
  onTurnEnd?: (event: InkTranscriptEvent) => void;
  onError?: (error: CartesiaTransportError, event?: InkErrorEvent) => void;
  onClose?: (event: { code?: number; reason?: string; wasClean?: boolean }) => void;
}

export interface InkConnectedEvent {
  type: "connected";
  requestId: string;
}

export interface InkTurnStartEvent {
  type: "turn.start";
  requestId: string;
}

export interface InkTranscriptEvent {
  type: "turn.update" | "turn.eager_end" | "turn.end";
  transcript: string;
  requestId: string;
}

export interface InkTurnResumeEvent {
  type: "turn.resume";
  requestId: string;
}

export interface InkErrorEvent {
  type: "error";
  statusCode: number;
  title: string;
  message: string;
  errorCode?: string;
  docUrl?: string;
  requestId?: string;
}

export type InkServerEvent =
  | InkConnectedEvent
  | InkTurnStartEvent
  | InkTranscriptEvent
  | InkTurnResumeEvent
  | InkErrorEvent;

export interface InkTurnState {
  turnEpoch: number;
  active: boolean;
  finalDelivered: boolean;
}

export interface InkTurnTransition {
  state: InkTurnState;
  deliverFinal: boolean;
}

export const INITIAL_INK_TURN_STATE: InkTurnState = {
  turnEpoch: 0,
  active: false,
  finalDelivered: false,
};

export function buildInkWebSocketUrl(options: Pick<
  InkClientOptions,
  "accessToken" | "encoding" | "sampleRate" | "keyterms" | "turn" | "endpoint"
>): string {
  validateInkOptions(options);
  return buildTokenWebSocketUrl(options.endpoint ?? CARTESIA_STT_URL, options.accessToken, {
    model: "ink-2",
    encoding: options.encoding,
    sample_rate: options.sampleRate,
    keyterm: options.keyterms,
    turn_start_threshold: options.turn?.startThreshold,
    turn_eager_end_threshold: options.turn?.eagerEndThreshold,
    turn_end_threshold: options.turn?.endThreshold,
    turn_end_timeout_ms: options.turn?.endTimeoutMs,
  });
}

export function parseInkServerEvent(text: string): InkServerEvent {
  const value = parseJsonObject(text);
  const type = requireString(value, "type");
  if (type === "connected") {
    return { type, requestId: requireString(value, "request_id", type) };
  }
  if (type === "turn.start" || type === "turn.resume") {
    return { type, requestId: requireString(value, "request_id", type) };
  }
  if (type === "turn.update" || type === "turn.eager_end" || type === "turn.end") {
    return {
      type,
      transcript: requireString(value, "transcript", type),
      requestId: requireString(value, "request_id", type),
    };
  }
  if (type === "error") {
    return {
      type,
      statusCode: requireNumber(value, "status_code", type),
      title: requireString(value, "title", type),
      message: requireString(value, "message", type),
      errorCode: optionalString(value, "error_code"),
      docUrl: optionalString(value, "doc_url"),
      requestId: optionalString(value, "request_id"),
    };
  }
  throw new CartesiaTransportError(`Unknown Cartesia Ink event "${type}"`, "unknown_event");
}

export function transitionInkTurn(
  state: InkTurnState,
  event: InkServerEvent,
): InkTurnTransition {
  if (event.type === "turn.start") {
    return {
      state: { turnEpoch: state.turnEpoch + 1, active: true, finalDelivered: false },
      deliverFinal: false,
    };
  }
  if (event.type !== "turn.end") return { state, deliverFinal: false };
  if (state.finalDelivered && !state.active) return { state, deliverFinal: false };

  return {
    state: {
      turnEpoch: state.active ? state.turnEpoch : state.turnEpoch + 1,
      active: false,
      finalDelivered: true,
    },
    deliverFinal: true,
  };
}

export class CartesiaInkClient {
  private socket: WebSocketLike | null = null;
  private connectionEpoch = 0;
  private turnState = INITIAL_INK_TURN_STATE;
  private connectPromise: Promise<void> | null = null;
  private rejectConnect: ((error: CartesiaTransportError) => void) | null = null;

  constructor(private readonly options: InkClientOptions) {
    validateInkOptions(options);
  }

  get isOpen(): boolean {
    return socketIsOpen(this.socket);
  }

  connect(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const epoch = ++this.connectionEpoch;
    const factory = this.options.webSocketFactory ?? defaultWebSocketFactory;
    let socket: WebSocketLike;
    try {
      socket = factory(buildInkWebSocketUrl(this.options));
    } catch (cause) {
      return Promise.reject(asTransportError(cause, "Failed to create Cartesia Ink WebSocket"));
    }
    this.socket = socket;
    this.turnState = INITIAL_INK_TURN_STATE;
    socket.binaryType = "arraybuffer";

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      this.rejectConnect = reject;
      socket.onopen = () => {
        if (!this.isCurrent(epoch, socket)) return;
        settled = true;
        this.rejectConnect = null;
        resolve();
      };
      socket.onmessage = (message) => {
        if (!this.isCurrent(epoch, socket)) return;
        if (typeof message.data !== "string") {
          this.reportError(new CartesiaTransportError(
            "Cartesia Ink sent an unexpected binary response",
            "unexpected_binary_message",
          ));
          return;
        }
        try {
          this.handleEvent(parseInkServerEvent(message.data));
        } catch (cause) {
          this.reportError(asTransportError(cause, "Invalid Cartesia Ink message"));
        }
      };
      socket.onerror = (cause) => {
        if (!this.isCurrent(epoch, socket)) return;
        const error = new CartesiaTransportError("Cartesia Ink WebSocket error", "websocket_error", cause);
        this.reportError(error);
        if (!settled) {
          settled = true;
          this.rejectConnect = null;
          reject(error);
        }
      };
      socket.onclose = (event) => {
        if (!this.isCurrent(epoch, socket)) return;
        this.socket = null;
        this.connectPromise = null;
        this.rejectConnect = null;
        this.options.onClose?.(event);
        if (!settled) {
          settled = true;
          reject(new CartesiaTransportError(formatSocketClose(event), "websocket_closed"));
        }
      };
    }).finally(() => {
      if (this.connectionEpoch === epoch) this.connectPromise = null;
    });
    return this.connectPromise;
  }

  sendAudio(audio: BinaryAudio): void {
    const socket = this.requireOpenSocket();
    socket.send(audioToArrayBuffer(audio));
  }

  updateTurnConfig(turn: InkTurnConfig): void {
    validateTurnConfig(turn);
    this.requireOpenSocket().send(JSON.stringify({
      type: "config",
      turn: {
        start_threshold: turn.startThreshold,
        eager_end_threshold: turn.eagerEndThreshold,
        end_threshold: turn.endThreshold,
        end_timeout_ms: turn.endTimeoutMs,
      },
    }));
  }

  finish(): void {
    this.requireOpenSocket().send(JSON.stringify({ type: "close" }));
  }

  close(code = 1000, reason = "client closed"): void {
    const socket = this.socket;
    const rejectConnect = this.rejectConnect;
    ++this.connectionEpoch;
    this.socket = null;
    this.connectPromise = null;
    this.rejectConnect = null;
    this.turnState = INITIAL_INK_TURN_STATE;
    rejectConnect?.(new CartesiaTransportError("Cartesia Ink connection was closed", "connection_cancelled"));
    if (socket && socket.readyState < 2) socket.close(code, reason);
  }

  private isCurrent(epoch: number, socket: WebSocketLike): boolean {
    return this.connectionEpoch === epoch && this.socket === socket;
  }

  private requireOpenSocket(): WebSocketLike {
    if (!socketIsOpen(this.socket)) {
      throw new CartesiaTransportError("Cartesia Ink WebSocket is not open", "socket_not_open");
    }
    return this.socket;
  }

  private handleEvent(event: InkServerEvent): void {
    const transition = transitionInkTurn(this.turnState, event);
    this.turnState = transition.state;
    switch (event.type) {
      case "connected":
        this.options.onConnected?.(event);
        break;
      case "turn.start":
        this.options.onTurnStart?.(event);
        break;
      case "turn.update":
        this.options.onTurnUpdate?.(event);
        break;
      case "turn.eager_end":
        this.options.onTurnEagerEnd?.(event);
        break;
      case "turn.resume":
        this.options.onTurnResume?.(event);
        break;
      case "turn.end":
        if (transition.deliverFinal) this.options.onTurnEnd?.(event);
        break;
      case "error":
        this.reportError(
          new CartesiaTransportError(`${event.title}: ${event.message}`, event.errorCode ?? "provider_error"),
          event,
        );
        break;
    }
  }

  private reportError(error: CartesiaTransportError, event?: InkErrorEvent): void {
    this.options.onError?.(error, event);
  }
}

function validateInkOptions(options: Pick<
  InkClientOptions,
  "accessToken" | "encoding" | "sampleRate" | "keyterms" | "turn"
>): void {
  if (!Number.isInteger(options.sampleRate) || options.sampleRate <= 0) {
    throw new CartesiaTransportError("Ink sampleRate must be a positive integer", "invalid_configuration");
  }
  if ((options.keyterms?.length ?? 0) > 100) {
    throw new CartesiaTransportError("Ink accepts at most 100 keyterms", "invalid_configuration");
  }
  validateTurnConfig(options.turn ?? {});
}

function validateTurnConfig(turn: InkTurnConfig): void {
  validateRange(turn.startThreshold, 0.5, 0.9, "startThreshold");
  validateRange(turn.eagerEndThreshold, 0.3, 0.6, "eagerEndThreshold");
  validateRange(turn.endThreshold, 0.05, 0.5, "endThreshold");
  validateRange(turn.endTimeoutMs, 640, 11200, "endTimeoutMs");

  const start = turn.startThreshold ?? 0.8;
  const eager = turn.eagerEndThreshold ?? 0.4;
  const end = turn.endThreshold ?? 0.2;
  if (!(start > eager && eager > end)) {
    throw new CartesiaTransportError(
      "Ink thresholds must satisfy startThreshold > eagerEndThreshold > endThreshold",
      "invalid_configuration",
    );
  }
}

function validateRange(value: number | undefined, minimum: number, maximum: number, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new CartesiaTransportError(
      `Ink ${name} must be between ${minimum} and ${maximum}`,
      "invalid_configuration",
    );
  }
}

function asTransportError(cause: unknown, message: string): CartesiaTransportError {
  return cause instanceof CartesiaTransportError
    ? cause
    : new CartesiaTransportError(message, "transport_error", cause);
}
