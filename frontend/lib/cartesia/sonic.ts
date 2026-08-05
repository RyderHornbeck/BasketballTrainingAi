import {
  CARTESIA_TTS_URL,
  CartesiaTransportError,
  buildTokenWebSocketUrl,
  decodeBase64,
  defaultWebSocketFactory,
  formatSocketClose,
  optionalString,
  parseJsonObject,
  requireBoolean,
  requireNumber,
  requireString,
  socketIsOpen,
  type WebSocketFactory,
  type WebSocketLike,
} from "./protocol";

export type SonicEncoding = "pcm_f32le" | "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";
export type SonicSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export type SonicEmotion =
  | "neutral"
  | "calm"
  | "content"
  | "happy"
  | "excited"
  | "enthusiastic"
  | "determined"
  | "angry"
  | "sad";

export interface SonicGenerationConfig {
  volume?: number;
  speed?: number;
  emotion?: SonicEmotion;
}

export interface SonicClientOptions {
  accessToken: string;
  endpoint?: string;
  webSocketFactory?: WebSocketFactory;
  onError?: (error: CartesiaTransportError, event?: SonicErrorEvent) => void;
  onClose?: (event: { code?: number; reason?: string; wasClean?: boolean }) => void;
}

export interface SonicContextOptions {
  contextId?: string;
  voiceId: string;
  encoding: SonicEncoding;
  sampleRate: SonicSampleRate;
  language?: string;
  maxBufferDelayMs?: number;
  addTimestamps?: boolean;
  addPhonemeTimestamps?: boolean;
  useNormalizedTimestamps?: boolean;
  pronunciationDictId?: string;
  generationConfig?: SonicGenerationConfig;
  onChunk?: (event: SonicChunkEvent) => void;
  onDone?: (event: SonicDoneEvent) => void;
  onTimestamps?: (event: SonicTimestampsEvent) => void;
  onPhonemeTimestamps?: (event: SonicPhonemeTimestampsEvent) => void;
  onFlushDone?: (event: SonicFlushDoneEvent) => void;
  onError?: (error: CartesiaTransportError, event?: SonicErrorEvent) => void;
}

interface SonicBaseEvent {
  contextId: string;
  done: boolean;
  statusCode: number;
}

export interface SonicChunkEvent extends SonicBaseEvent {
  type: "chunk";
  audio: Uint8Array;
  stepTime: number;
}

export interface SonicDoneEvent extends SonicBaseEvent {
  type: "done";
}

export interface SonicFlushDoneEvent extends SonicBaseEvent {
  type: "flush_done";
  flushDone: boolean;
  flushId: number;
}

export interface SonicTimestamps {
  words: string[];
  start: number[];
  end: number[];
}

export interface SonicTimestampsEvent extends SonicBaseEvent {
  type: "timestamps";
  wordTimestamps?: SonicTimestamps;
}

export interface SonicPhonemeTimestamps {
  phonemes: string[];
  start: number[];
  end: number[];
}

export interface SonicPhonemeTimestampsEvent extends SonicBaseEvent {
  type: "phoneme_timestamps";
  phonemeTimestamps?: SonicPhonemeTimestamps;
}

export interface SonicErrorEvent {
  type: "error";
  contextId?: string;
  done?: boolean;
  statusCode: number;
  title: string;
  message: string;
  errorCode?: string;
  docUrl?: string;
  requestId?: string;
}

export type SonicServerEvent =
  | SonicChunkEvent
  | SonicDoneEvent
  | SonicFlushDoneEvent
  | SonicTimestampsEvent
  | SonicPhonemeTimestampsEvent
  | SonicErrorEvent;

export interface SonicGenerationRequest {
  model_id: "sonic-3.5";
  transcript: string;
  voice: { mode: "id"; id: string };
  output_format: {
    container: "raw";
    encoding: SonicEncoding;
    sample_rate: SonicSampleRate;
  };
  context_id: string;
  continue: boolean;
  language?: string;
  max_buffer_delay_ms?: number;
  flush?: boolean;
  add_timestamps?: boolean;
  add_phoneme_timestamps?: boolean;
  use_normalized_timestamps?: boolean;
  pronunciation_dict_id?: string;
  generation_config?: SonicGenerationConfig;
}

export interface SonicTextChunk {
  chunk: string;
  remainder: string;
}

export interface SonicTextChunks {
  chunks: string[];
  remainder: string;
}

export interface SonicAudioCacheKey {
  finalText: string;
  voiceId: string;
  locale: string;
  codec: SonicEncoding;
  sampleRate: SonicSampleRate;
  speed: number;
  emotion: SonicEmotion;
  rendererVersion: string;
}

export interface SonicAudioCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

interface SonicAudioCacheEntry {
  audio: Uint8Array;
  byteLength: number;
}

const DEFAULT_SONIC_CACHE_MAX_ENTRIES = 32;
const DEFAULT_SONIC_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export type CoachSpeechSafetyResult =
  | { status: "safe"; speech: string }
  | { status: "hold"; speech: "" }
  | { status: "unsafe"; speech: "" };

/** Convert model text into plain, unambiguous language before TTS. */
export function sanitizeCoachSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1 for $2")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/(\d)\s*\+\s*(\d)/g, "$1 plus $2")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 minus $2")
    .replace(/\s*=\s*/g, " equals ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[•*_#`{}\[\]<>]/g, " ")
    .replace(/\s*\/\s*/g, " or ")
    .replace(/\s+/g, " ")
    .trimStart();
}

/**
 * Final boundary for text headed to a speech provider. This intentionally
 * checks the unsanitized text first: stripping braces and tags can turn tool
 * payloads into plausible-sounding words.
 */
export function gateCoachSpeechText(
  text: string,
  final: boolean,
): CoachSpeechSafetyResult {
  const trimmed = text.trim();
  if (!trimmed) return { status: "safe", speech: "" };
  const normalized = trimmed.replace(/\\"/g, '"').replace(/\\'/g, "'");

  if (containsInternalSpeechSyntax(normalized)) {
    return { status: "unsafe", speech: "" };
  }
  // A JSON object can arrive over several text deltas. Do not release an
  // innocent-looking prefix before its quoted keys and tool intent arrive.
  if (/^\s*\{/.test(normalized)) {
    return final
      ? { status: "unsafe", speech: "" }
      : { status: "hold", speech: "" };
  }
  if (!final && /(?:^|\n)\s*(?:data|event)\s*:\s*$/i.test(normalized)) {
    return { status: "hold", speech: "" };
  }
  return { status: "safe", speech: sanitizeCoachSpeechText(text) };
}

function containsInternalSpeechSyntax(text: string): boolean {
  return [
    /```/,
    /<\/?\s*(?:tool|tool_use|tool_call|function|function_call)\b/i,
    /(?:^|\n)\s*(?:data|event)\s*:\s*(?:\{|\[|\[DONE\]|response\.|content_block_|message_)/i,
    /\[\s*DONE\s*\]/i,
    /(?:^|\s)(?:assistant|model)\s+to\s*=/i,
    /\bfunction[\s_-]*call\b\s*(?:=|:|\binvoke\b)/i,
    /\btool[\s_-]*(?:call|use|result|name)\b\s*(?:=|:)/i,
    /\b(?:invoke|recipient|arguments?|parameters?)\s*(?:=|:)/i,
    /\b(?:function_call|tool_calls?|tool_use|call_id|arguments_json|partial_json|input_schema)\b\s*[:=]/i,
    /["'](?:type|name|arguments|tool_name|call_id|function_call|tool_calls?|input)["']\s*:/i,
    /\b[A-Za-z][\w.-]*_[A-Za-z][\w.-]*\s*\(\s*(?:\{|["']|$)/,
  ].some((pattern) => pattern.test(text));
}

/**
 * Extracts every complete phrase currently available, then optionally emits
 * one word-safe fallback chunk. The returned strings are exact slices of the
 * input so whitespace and punctuation are preserved.
 */
export function drainSonicTextChunks(
  text: string,
  force: boolean,
  minimumCharacters = 32,
  maximumCharacters = 96,
): SonicTextChunks {
  if (!text) return { chunks: [], remainder: "" };
  if (force) return { chunks: [text], remainder: "" };

  const chunks: string[] = [];
  let consumed = 0;
  for (const end of completePhraseEnds(text)) {
    chunks.push(text.slice(consumed, end));
    consumed = end;
  }

  let remainder = text.slice(consumed);
  if (remainder.length >= minimumCharacters) {
    const fallbackEnd = wordSafeFallbackEnd(
      remainder,
      minimumCharacters,
      Math.max(minimumCharacters, maximumCharacters),
    );
    if (fallbackEnd > 0) {
      chunks.push(remainder.slice(0, fallbackEnd));
      remainder = remainder.slice(fallbackEnd);
    }
  }
  return { chunks, remainder };
}

/**
 * Compatibility wrapper for consumers that pull one chunk at a time. Callers
 * can loop until `chunk` is empty; `drainSonicTextChunks` is preferred when
 * all currently eligible phrases should be pushed in one pass.
 */
export function takeSonicTextChunk(
  text: string,
  force: boolean,
  minimumCharacters = 32,
  maximumCharacters = 96,
): SonicTextChunk {
  const { chunks, remainder } = drainSonicTextChunks(
    text,
    force,
    minimumCharacters,
    maximumCharacters,
  );
  if (chunks.length === 0) return { chunk: "", remainder };
  return {
    chunk: chunks[0],
    remainder: chunks.slice(1).join("") + remainder,
  };
}

/** Builds a collision-safe key from only final audio-rendering inputs. */
export function buildSonicAudioCacheKey(input: SonicAudioCacheKey): string {
  return JSON.stringify([
    input.finalText,
    input.voiceId,
    input.locale,
    input.codec,
    input.sampleRate,
    input.speed,
    input.emotion,
    input.rendererVersion,
  ]);
}

/**
 * Bounded, in-memory LRU for completed Sonic audio. It deliberately has no
 * knowledge of turn, interruption, or playback state.
 */
export class SonicAudioLruCache {
  private readonly entries = new Map<string, SonicAudioCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private storedBytes = 0;

  constructor(options: SonicAudioCacheOptions = {}) {
    this.maxEntries = requirePositiveInteger(
      options.maxEntries ?? DEFAULT_SONIC_CACHE_MAX_ENTRIES,
      "maxEntries",
    );
    this.maxBytes = requirePositiveInteger(
      options.maxBytes ?? DEFAULT_SONIC_CACHE_MAX_BYTES,
      "maxBytes",
    );
  }

  get size(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.storedBytes;
  }

  get(input: SonicAudioCacheKey): Uint8Array | undefined {
    const key = buildSonicAudioCacheKey(input);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.audio.slice();
  }

  set(input: SonicAudioCacheKey, audio: Uint8Array): void {
    const key = buildSonicAudioCacheKey(input);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.storedBytes -= existing.byteLength;
    }
    if (audio.byteLength > this.maxBytes) return;

    const storedAudio = audio.slice();
    this.entries.set(key, { audio: storedAudio, byteLength: storedAudio.byteLength });
    this.storedBytes += storedAudio.byteLength;
    this.evictToBounds();
  }

  has(input: SonicAudioCacheKey): boolean {
    return this.entries.has(buildSonicAudioCacheKey(input));
  }

  clear(): void {
    this.entries.clear();
    this.storedBytes = 0;
  }

  private evictToBounds(): void {
    while (this.entries.size > this.maxEntries || this.storedBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.storedBytes -= oldest?.byteLength ?? 0;
    }
  }
}

function completePhraseEnds(text: string): number[] {
  const ends: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!".!?,;:".includes(character)) continue;
    if (
      character === "." &&
      index > 0 &&
      index + 1 < text.length &&
      isDigit(text[index - 1]) &&
      isDigit(text[index + 1])
    ) {
      continue;
    }

    let end = index + 1;
    while (end < text.length && isClosingPunctuation(text[end])) end += 1;
    if (end < text.length && !isWhitespace(text[end])) continue;
    while (end < text.length && isWhitespace(text[end])) end += 1;
    ends.push(end);
    index = end - 1;
  }
  return ends;
}

function wordSafeFallbackEnd(
  text: string,
  minimumCharacters: number,
  maximumCharacters: number,
): number {
  const lastCandidate = Math.min(text.length - 1, maximumCharacters);
  for (let index = lastCandidate; index >= minimumCharacters; index -= 1) {
    if (isWhitespace(text[index])) {
      let end = index + 1;
      while (end < text.length && isWhitespace(text[end])) end += 1;
      return end;
    }
  }
  return 0;
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function isClosingPunctuation(value: string): boolean {
  return value === '"' || value === "'" || value === "\u2019" || value === "\u201d" ||
    value === ")" || value === "]" || value === "}";
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Sonic audio cache ${name} must be a positive integer`);
  }
  return value;
}

export function buildSonicWebSocketUrl(
  accessToken: string,
  endpoint = CARTESIA_TTS_URL,
): string {
  return buildTokenWebSocketUrl(endpoint, accessToken);
}

export function buildSonicGenerationRequest(
  contextId: string,
  options: SonicContextOptions,
  transcript: string,
  continueContext: boolean,
  flush = false,
): SonicGenerationRequest {
  validateSonicContextOptions(options);
  if (!contextId) {
    throw new CartesiaTransportError("Sonic contextId is required", "invalid_configuration");
  }
  return {
    model_id: "sonic-3.5",
    transcript,
    voice: { mode: "id", id: options.voiceId },
    output_format: {
      container: "raw",
      encoding: options.encoding,
      sample_rate: options.sampleRate,
    },
    context_id: contextId,
    continue: continueContext,
    language: options.language,
    max_buffer_delay_ms: options.maxBufferDelayMs,
    flush: flush || undefined,
    add_timestamps: options.addTimestamps,
    add_phoneme_timestamps: options.addPhonemeTimestamps,
    use_normalized_timestamps: options.useNormalizedTimestamps,
    pronunciation_dict_id: options.pronunciationDictId,
    generation_config: options.generationConfig,
  };
}

export function parseSonicServerEvent(text: string): SonicServerEvent {
  const value = parseJsonObject(text);
  const type = requireString(value, "type");
  if (type === "error") {
    return {
      type,
      contextId: optionalString(value, "context_id"),
      done: typeof value.done === "boolean" ? value.done : undefined,
      statusCode: requireNumber(value, "status_code", type),
      title: requireString(value, "title", type),
      message: requireString(value, "message", type),
      errorCode: optionalString(value, "error_code"),
      docUrl: optionalString(value, "doc_url"),
      requestId: optionalString(value, "request_id"),
    };
  }

  const base = {
    contextId: requireString(value, "context_id", type),
    done: requireBoolean(value, "done", type),
    statusCode: requireNumber(value, "status_code", type),
  };
  if (type === "chunk") {
    return {
      type,
      ...base,
      audio: decodeBase64(requireString(value, "data", type)),
      stepTime: requireNumber(value, "step_time", type),
    };
  }
  if (type === "done") return { type, ...base };
  if (type === "flush_done") {
    return {
      type,
      ...base,
      flushDone: requireBoolean(value, "flush_done", type),
      flushId: requireNumber(value, "flush_id", type),
    };
  }
  if (type === "timestamps") {
    return { type, ...base, wordTimestamps: parseTimestampSet(value.word_timestamps, "words") };
  }
  if (type === "phoneme_timestamps") {
    return {
      type,
      ...base,
      phonemeTimestamps: parseTimestampSet(value.phoneme_timestamps, "phonemes"),
    };
  }
  throw new CartesiaTransportError(`Unknown Cartesia Sonic event "${type}"`, "unknown_event");
}

interface ContextRecord {
  socketEpoch: number;
  handleEpoch: number;
  options: SonicContextOptions;
  inputEnded: boolean;
  cancelled: boolean;
}

export class CartesiaSonicContext {
  constructor(
    readonly id: string,
    private readonly handleEpoch: number,
    private readonly client: CartesiaSonicClient,
  ) {}

  push(transcript: string): void {
    this.client.sendContextInput(this.id, this.handleEpoch, transcript, true, false);
  }

  finish(transcript = ""): void {
    this.client.sendContextInput(this.id, this.handleEpoch, transcript, false, false);
  }

  flush(transcript = ""): void {
    this.client.sendContextInput(this.id, this.handleEpoch, transcript, true, true);
  }

  cancel(): void {
    this.client.cancelContext(this.id, this.handleEpoch);
  }
}

export class CartesiaSonicClient {
  private socket: WebSocketLike | null = null;
  private connectionEpoch = 0;
  private nextContextEpoch = 0;
  private nextContextId = 0;
  private connectPromise: Promise<void> | null = null;
  private rejectConnect: ((error: CartesiaTransportError) => void) | null = null;
  private readonly contexts = new Map<string, ContextRecord>();
  private readonly usedContextIds = new Set<string>();

  constructor(private readonly options: SonicClientOptions) {}

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
      socket = factory(buildSonicWebSocketUrl(this.options.accessToken, this.options.endpoint));
    } catch (cause) {
      return Promise.reject(asTransportError(cause, "Failed to create Cartesia Sonic WebSocket"));
    }
    this.socket = socket;

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
            "Cartesia Sonic sent an unexpected binary response",
            "unexpected_binary_message",
          ));
          return;
        }
        try {
          this.handleEvent(parseSonicServerEvent(message.data), epoch);
        } catch (cause) {
          this.reportError(asTransportError(cause, "Invalid Cartesia Sonic message"));
        }
      };
      socket.onerror = (cause) => {
        if (!this.isCurrent(epoch, socket)) return;
        const error = new CartesiaTransportError("Cartesia Sonic WebSocket error", "websocket_error", cause);
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
        this.contexts.clear();
        this.usedContextIds.clear();
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

  createContext(options: SonicContextOptions): CartesiaSonicContext {
    this.requireOpenSocket();
    validateSonicContextOptions(options);
    const id = options.contextId ?? this.createContextId();
    if (this.usedContextIds.has(id)) {
      throw new CartesiaTransportError(
        `Sonic context ID "${id}" has already been used on this connection`,
        "duplicate_context_id",
      );
    }
    const handleEpoch = ++this.nextContextEpoch;
    this.usedContextIds.add(id);
    this.contexts.set(id, {
      socketEpoch: this.connectionEpoch,
      handleEpoch,
      options,
      inputEnded: false,
      cancelled: false,
    });
    return new CartesiaSonicContext(id, handleEpoch, this);
  }

  close(code = 1000, reason = "client closed"): void {
    const socket = this.socket;
    const rejectConnect = this.rejectConnect;
    ++this.connectionEpoch;
    this.socket = null;
    this.connectPromise = null;
    this.rejectConnect = null;
    this.contexts.clear();
    this.usedContextIds.clear();
    rejectConnect?.(
      new CartesiaTransportError("Cartesia Sonic connection was closed", "connection_cancelled"),
    );
    if (socket && socket.readyState < 2) socket.close(code, reason);
  }

  sendContextInput(
    id: string,
    handleEpoch: number,
    transcript: string,
    continueContext: boolean,
    flush: boolean,
  ): void {
    const socket = this.requireOpenSocket();
    const context = this.requireCurrentContext(id, handleEpoch);
    if (context.cancelled) {
      throw new CartesiaTransportError("Sonic context has been cancelled", "context_cancelled");
    }
    if (context.inputEnded) {
      throw new CartesiaTransportError("Sonic context input has already ended", "context_ended");
    }
    socket.send(JSON.stringify(
      buildSonicGenerationRequest(id, context.options, transcript, continueContext, flush),
    ));
    if (!continueContext) context.inputEnded = true;
  }

  cancelContext(id: string, handleEpoch: number): void {
    const socket = this.requireOpenSocket();
    const context = this.requireCurrentContext(id, handleEpoch);
    if (context.cancelled) return;
    context.cancelled = true;
    socket.send(JSON.stringify({ context_id: id, cancel: true }));
  }

  private createContextId(): string {
    this.nextContextId += 1;
    return `cartesia-${Date.now().toString(36)}-${this.nextContextId.toString(36)}`;
  }

  private isCurrent(epoch: number, socket: WebSocketLike): boolean {
    return this.connectionEpoch === epoch && this.socket === socket;
  }

  private requireOpenSocket(): WebSocketLike {
    if (!socketIsOpen(this.socket)) {
      throw new CartesiaTransportError("Cartesia Sonic WebSocket is not open", "socket_not_open");
    }
    return this.socket;
  }

  private requireCurrentContext(id: string, handleEpoch: number): ContextRecord {
    const context = this.contexts.get(id);
    if (
      !context ||
      context.handleEpoch !== handleEpoch ||
      context.socketEpoch !== this.connectionEpoch
    ) {
      throw new CartesiaTransportError("Sonic context is stale", "stale_context");
    }
    return context;
  }

  private handleEvent(event: SonicServerEvent, socketEpoch: number): void {
    if (event.type === "error" && !event.contextId) {
      this.reportError(providerError(event), event);
      return;
    }
    const contextId = event.contextId;
    if (!contextId) return;
    const context = this.contexts.get(contextId);
    if (!context || context.socketEpoch !== socketEpoch || context.cancelled) return;

    switch (event.type) {
      case "chunk":
        context.options.onChunk?.(event);
        break;
      case "done":
        context.options.onDone?.(event);
        this.contexts.delete(contextId);
        break;
      case "flush_done":
        context.options.onFlushDone?.(event);
        break;
      case "timestamps":
        context.options.onTimestamps?.(event);
        break;
      case "phoneme_timestamps":
        context.options.onPhonemeTimestamps?.(event);
        break;
      case "error": {
        const error = providerError(event);
        context.options.onError?.(error, event);
        this.options.onError?.(error, event);
        if (event.done) this.contexts.delete(contextId);
        break;
      }
    }
  }

  private reportError(error: CartesiaTransportError, event?: SonicErrorEvent): void {
    this.options.onError?.(error, event);
  }
}

function parseTimestampSet(
  value: unknown,
  label: "words",
): SonicTimestamps | undefined;
function parseTimestampSet(
  value: unknown,
  label: "phonemes",
): SonicPhonemeTimestamps | undefined;
function parseTimestampSet(
  value: unknown,
  label: "words" | "phonemes",
): SonicTimestamps | SonicPhonemeTimestamps | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CartesiaTransportError(`Invalid Sonic ${label} timestamps`, "invalid_message");
  }
  const record = value as Record<string, unknown>;
  const labels = record[label];
  const start = record.start;
  const end = record.end;
  if (
    !Array.isArray(labels) ||
    !labels.every((item) => typeof item === "string") ||
    !Array.isArray(start) ||
    !start.every((item) => typeof item === "number") ||
    !Array.isArray(end) ||
    !end.every((item) => typeof item === "number")
  ) {
    throw new CartesiaTransportError(`Invalid Sonic ${label} timestamps`, "invalid_message");
  }
  return label === "words"
    ? { words: labels, start, end }
    : { phonemes: labels, start, end };
}

function validateSonicContextOptions(options: SonicContextOptions): void {
  if (!options.voiceId.trim()) {
    throw new CartesiaTransportError("Sonic voiceId is required", "invalid_configuration");
  }
  if (
    options.maxBufferDelayMs !== undefined &&
    (!Number.isInteger(options.maxBufferDelayMs) ||
      options.maxBufferDelayMs < 0 ||
      options.maxBufferDelayMs > 5000)
  ) {
    throw new CartesiaTransportError(
      "Sonic maxBufferDelayMs must be an integer between 0 and 5000",
      "invalid_configuration",
    );
  }
  const generation = options.generationConfig;
  if (generation?.volume !== undefined && (generation.volume < 0.5 || generation.volume > 2)) {
    throw new CartesiaTransportError("Sonic volume must be between 0.5 and 2", "invalid_configuration");
  }
  if (generation?.speed !== undefined && (generation.speed < 0.6 || generation.speed > 1.5)) {
    throw new CartesiaTransportError("Sonic speed must be between 0.6 and 1.5", "invalid_configuration");
  }
}

function providerError(event: SonicErrorEvent): CartesiaTransportError {
  return new CartesiaTransportError(
    `${event.title}: ${event.message}`,
    event.errorCode ?? "provider_error",
  );
}

function asTransportError(cause: unknown, message: string): CartesiaTransportError {
  return cause instanceof CartesiaTransportError
    ? cause
    : new CartesiaTransportError(message, "transport_error", cause);
}
