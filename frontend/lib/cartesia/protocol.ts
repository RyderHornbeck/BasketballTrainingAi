export const CARTESIA_API_VERSION = "2026-03-01" as const;
export const CARTESIA_STT_URL = "wss://api.cartesia.ai/stt/turns/websocket";
export const CARTESIA_TTS_URL = "wss://api.cartesia.ai/tts/websocket";

export interface WebSocketMessageEventLike {
  data: unknown;
}

export interface WebSocketCloseEventLike {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export interface WebSocketLike {
  readonly readyState: number;
  binaryType?: string;
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: WebSocketCloseEventLike) => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export class CartesiaTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CartesiaTransportError";
  }
}

export function defaultWebSocketFactory(url: string): WebSocketLike {
  const Constructor = (globalThis as { WebSocket?: new (value: string) => unknown }).WebSocket;
  if (!Constructor) {
    throw new CartesiaTransportError("WebSocket is unavailable in this runtime", "websocket_unavailable");
  }
  return new Constructor(url) as WebSocketLike;
}

export function buildTokenWebSocketUrl(
  endpoint: string,
  accessToken: string,
  query: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>> = {},
): string {
  if (!accessToken.trim()) {
    throw new CartesiaTransportError("A short-lived Cartesia access token is required", "missing_access_token");
  }

  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("cartesia_version", CARTESIA_API_VERSION);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new CartesiaTransportError("Cartesia sent invalid JSON", "invalid_json", cause);
  }
  if (!isRecord(value)) {
    throw new CartesiaTransportError("Cartesia sent a non-object message", "invalid_message");
  }
  return value;
}

export function requireString(
  value: Record<string, unknown>,
  key: string,
  messageType?: string,
): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new CartesiaTransportError(
      `Cartesia ${messageType ?? "message"} is missing string field "${key}"`,
      "invalid_message",
    );
  }
  return field;
}

export function requireNumber(
  value: Record<string, unknown>,
  key: string,
  messageType?: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new CartesiaTransportError(
      `Cartesia ${messageType ?? "message"} is missing numeric field "${key}"`,
      "invalid_message",
    );
  }
  return field;
}

export function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  messageType?: string,
): boolean {
  const field = value[key];
  if (typeof field !== "boolean") {
    throw new CartesiaTransportError(
      `Cartesia ${messageType ?? "message"} is missing boolean field "${key}"`,
      "invalid_message",
    );
  }
  return field;
}

export function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const lookup = new Int16Array(128);
  lookup.fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    lookup[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return lookup;
})();

export function decodeBase64(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, "");
  const paddingIndex = normalized.indexOf("=");
  if (
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    (paddingIndex !== -1 && paddingIndex < normalized.length - 2)
  ) {
    throw new CartesiaTransportError("Cartesia sent invalid base64 audio", "invalid_base64");
  }

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const outputLength = Math.floor((normalized.length * 3) / 4) - padding;
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let index = 0; index < normalized.length; index += 4) {
    const a = decodeBase64Character(normalized[index]);
    const b = decodeBase64Character(normalized[index + 1]);
    const c = normalized[index + 2] === "=" || normalized[index + 2] === undefined
      ? 0
      : decodeBase64Character(normalized[index + 2]);
    const d = normalized[index + 3] === "=" || normalized[index + 3] === undefined
      ? 0
      : decodeBase64Character(normalized[index + 3]);
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < outputLength) output[outputIndex++] = (bits >> 16) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = (bits >> 8) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = bits & 0xff;
  }
  return output;
}

function decodeBase64Character(character: string | undefined): number {
  if (!character) {
    throw new CartesiaTransportError("Cartesia sent invalid base64 audio", "invalid_base64");
  }
  const code = character.charCodeAt(0);
  const value = code < BASE64_LOOKUP.length ? BASE64_LOOKUP[code] : -1;
  if (value < 0) {
    throw new CartesiaTransportError("Cartesia sent invalid base64 audio", "invalid_base64");
  }
  return value;
}

export type BinaryAudio = ArrayBuffer | ArrayBufferView | string;

export function audioToArrayBuffer(audio: BinaryAudio): ArrayBuffer {
  if (typeof audio === "string") {
    return uint8ArrayToArrayBuffer(decodeBase64(audio));
  }
  if (audio instanceof ArrayBuffer) return audio;
  return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
}

export function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function socketIsOpen(socket: WebSocketLike | null): socket is WebSocketLike {
  return socket?.readyState === 1;
}

export function formatSocketClose(event: WebSocketCloseEventLike): string {
  const code = event.code === undefined ? "" : ` (${event.code})`;
  const reason = event.reason ? `: ${event.reason}` : "";
  return `Cartesia WebSocket closed${code}${reason}`;
}
