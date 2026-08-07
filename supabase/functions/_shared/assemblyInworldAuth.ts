const ASSEMBLY_TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token";
const INWORLD_TOKEN_ENDPOINT = "https://api.inworld.ai/auth/v1/tokens/token:generate";
const INWORLD_ENGINE_HOST = "api-engine.inworld.ai";
const INWORLD_METHOD = "ai.inworld.engine.WorldEngine/GenerateToken";

export const ASSEMBLY_STREAMING_TOKEN_TTL_SECONDS = 60;
export const ASSEMBLY_MAX_SESSION_SECONDS = 10_800;

export interface AssemblyStreamingToken {
  token: string;
  expires_in: number;
  max_session_duration_seconds: number;
}

export interface InworldAccessToken {
  token: string;
  expires_at: string;
}

export class VoiceProviderAuthError extends Error {
  constructor(
    message: string,
    readonly provider: "assemblyai" | "inworld",
    readonly status = 502,
  ) {
    super(message);
    this.name = "VoiceProviderAuthError";
  }
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(
  key: string | Uint8Array,
  value: string,
): Promise<Uint8Array> {
  const rawKey = typeof key === "string"
    ? new TextEncoder().encode(key)
    : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey.buffer.slice(
      rawKey.byteOffset,
      rawKey.byteOffset + rawKey.byteLength,
    ) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)),
  );
}

function inworldDateTime(now = new Date()): string {
  // Inworld's HMAC scheme requires exactly YYYYMMDDHHMMSS in UTC. Do not
  // retain the ISO "T" separator or milliseconds in the signed value.
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

async function inworldSigningKey(
  secret: string,
  dateTime: string,
  nonce: string,
): Promise<string> {
  let signingKey: string | Uint8Array = `IW1${secret}`;
  for (const value of [
    dateTime,
    INWORLD_ENGINE_HOST,
    INWORLD_METHOD,
    nonce,
  ]) {
    signingKey = await hmacSha256(signingKey, value);
  }
  return hex(await hmacSha256(signingKey, "iw1_request"));
}

function parseInworldBasicCredential(value: string): { key: string; secret: string } {
  try {
    const decoded = new TextDecoder().decode(fromBase64(value.trim()));
    const separator = decoded.indexOf(":");
    const key = separator > 0 ? decoded.slice(0, separator) : "";
    const secret = separator > 0 ? decoded.slice(separator + 1) : "";
    if (key && secret) return { key, secret };
  } catch {
    // Return the provider-safe configuration error below.
  }
  throw new VoiceProviderAuthError(
    "INWORLD_API_KEY must be the Basic Base64 credential from Inworld.",
    "inworld",
    500,
  );
}

export async function mintAssemblyStreamingToken(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AssemblyStreamingToken> {
  if (!apiKey.trim()) {
    throw new VoiceProviderAuthError("ASSEMBLYAI_API_KEY is not configured.", "assemblyai", 500);
  }
  const url = new URL(ASSEMBLY_TOKEN_ENDPOINT);
  url.searchParams.set("expires_in_seconds", String(ASSEMBLY_STREAMING_TOKEN_TTL_SECONDS));
  url.searchParams.set("max_session_duration_seconds", String(ASSEMBLY_MAX_SESSION_SECONDS));
  const response = await fetcher(url, {
    headers: { Authorization: apiKey.trim() },
  }).catch(() => {
    throw new VoiceProviderAuthError("AssemblyAI token request failed.", "assemblyai");
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof payload?.token !== "string") {
    throw new VoiceProviderAuthError("AssemblyAI did not issue a streaming token.", "assemblyai");
  }
  return {
    token: payload.token,
    expires_in: typeof payload.expires_in_seconds === "number"
      ? payload.expires_in_seconds
      : ASSEMBLY_STREAMING_TOKEN_TTL_SECONDS,
    max_session_duration_seconds: ASSEMBLY_MAX_SESSION_SECONDS,
  };
}

export async function mintInworldAccessToken(
  apiKey: string,
  workspace?: string,
  fetcher: typeof fetch = fetch,
): Promise<InworldAccessToken> {
  const { key, secret } = parseInworldBasicCredential(apiKey);
  const dateTime = inworldDateTime();
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16))).slice(0, 12);
  const signature = await inworldSigningKey(secret, dateTime, nonce);
  const authorization =
    `IW1-HMAC-SHA256 ApiKey=${key},DateTime=${dateTime},Nonce=${nonce},Signature=${signature}`;
  const normalizedWorkspace = workspace?.trim()
    ? workspace.trim().startsWith("workspaces/")
      ? workspace.trim()
      : `workspaces/${workspace.trim()}`
    : null;
  const response = await fetcher(INWORLD_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      resources: normalizedWorkspace ? [normalizedWorkspace] : [],
    }),
  }).catch(() => {
    throw new VoiceProviderAuthError("Inworld token request failed.", "inworld");
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof payload?.token !== "string") {
    throw new VoiceProviderAuthError("Inworld did not issue an access token.", "inworld");
  }
  return {
    token: payload.token,
    expires_at: typeof payload.expirationTime === "string"
      ? payload.expirationTime
      : new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}
