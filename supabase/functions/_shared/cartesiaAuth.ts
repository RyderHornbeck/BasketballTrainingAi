export const CARTESIA_API_VERSION = "2026-03-01";
export const CARTESIA_TOKEN_ENDPOINT = "https://api.cartesia.ai/access-token";
export const CARTESIA_TOKEN_TTL_SECONDS = 300;

export interface CartesiaAccessToken {
  token: string;
  expires_at: string;
  expires_in: number;
  grants: readonly ["stt", "tts"];
}

export class CartesiaAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "CartesiaAuthError";
  }
}

function boundedTokenTtl(value: number): number {
  if (!Number.isFinite(value)) return CARTESIA_TOKEN_TTL_SECONDS;
  return Math.max(60, Math.min(900, Math.floor(value)));
}

export async function mintCartesiaSpeechToken(
  apiKey: string,
  options: {
    expiresIn?: number;
    fetcher?: typeof fetch;
    now?: Date;
  } = {},
): Promise<CartesiaAccessToken> {
  if (!apiKey.trim()) {
    throw new CartesiaAuthError("CARTESIA_API_KEY is not configured", 500);
  }

  const expiresIn = boundedTokenTtl(options.expiresIn ?? CARTESIA_TOKEN_TTL_SECONDS);
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetcher(CARTESIA_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": CARTESIA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grants: { stt: true, tts: true },
        expires_in: expiresIn,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? "Cartesia token request timed out"
      : "Cartesia token request failed";
    throw new CartesiaAuthError(detail, 502);
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new CartesiaAuthError(
      `Cartesia token request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      502,
      requestId,
    );
  }

  const payload = await response.json().catch(() => null) as { token?: unknown } | null;
  if (!payload || typeof payload.token !== "string" || payload.token.length < 16) {
    throw new CartesiaAuthError("Cartesia returned an invalid access token", 502, requestId);
  }

  const now = options.now ?? new Date();
  return {
    token: payload.token,
    expires_at: new Date(now.getTime() + expiresIn * 1_000).toISOString(),
    expires_in: expiresIn,
    grants: ["stt", "tts"],
  };
}
