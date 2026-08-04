import {
  CARTESIA_API_VERSION,
  CARTESIA_TOKEN_ENDPOINT,
  CartesiaAuthError,
  mintCartesiaSpeechToken,
} from "./cartesiaAuth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("mintCartesiaSpeechToken requests only short-lived STT and TTS grants", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const token = await mintCartesiaSpeechToken("sk_car_test", {
    expiresIn: 120,
    now: new Date("2026-08-04T12:00:00.000Z"),
    fetcher: (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Promise.resolve(Response.json({ token: "access-token-1234567890" }));
    },
  });

  assert(capturedUrl === CARTESIA_TOKEN_ENDPOINT, "expected access-token endpoint");
  const headers = new Headers(capturedInit?.headers);
  assert(
    headers.get("Cartesia-Version") === CARTESIA_API_VERSION,
    "expected current API version",
  );
  assert(headers.get("Authorization") === "Bearer sk_car_test", "expected API key");
  assert(
    capturedInit?.body ===
      JSON.stringify({ grants: { stt: true, tts: true }, expires_in: 120 }),
    "expected scoped token body",
  );
  assert(token.expires_in === 120, "expected requested TTL");
  assert(
    token.expires_at === "2026-08-04T12:02:00.000Z",
    "expected deterministic expiry",
  );
  assert(token.grants.join(",") === "stt,tts", "expected speech-only grants");
});

Deno.test("mintCartesiaSpeechToken bounds TTL and rejects malformed responses", async () => {
  let requestBody = "";
  let rejected = false;
  try {
    await mintCartesiaSpeechToken("sk_car_test", {
      expiresIn: 10_000,
      fetcher: (_url, init) => {
        requestBody = String(init?.body);
        return Promise.resolve(Response.json({ unexpected: true }));
      },
    });
  } catch (error) {
    rejected = error instanceof CartesiaAuthError && error.status === 502;
  }
  assert(JSON.parse(requestBody).expires_in === 900, "expected bounded token TTL");
  assert(rejected, "expected invalid provider response rejection");
});

Deno.test("mintCartesiaSpeechToken does not expose provider error status", async () => {
  let captured: CartesiaAuthError | undefined;
  try {
    await mintCartesiaSpeechToken("sk_car_test", {
      fetcher: () =>
        Promise.resolve(
          new Response('{"error":"invalid key"}', {
            status: 401,
            headers: { "x-request-id": "request-123" },
          }),
        ),
    });
  } catch (error) {
    if (error instanceof CartesiaAuthError) captured = error;
  }
  assert(captured?.status === 502, "expected upstream failure mapping");
  assert(captured?.requestId === "request-123", "expected request ID for logs");
});
