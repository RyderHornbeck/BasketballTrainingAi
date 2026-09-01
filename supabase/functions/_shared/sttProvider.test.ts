import { mintDeepgramAccessToken } from "./assemblyInworldAuth.ts";
import {
  DEEPGRAM_STREAMING_CONFIG,
  resolveCoachSttAuthorization,
  selectCoachSttProvider,
} from "./sttProvider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("DEEGRAM_BOOL selects Deepgram only for exact one", () => {
  assert(
    selectCoachSttProvider("1") === "deepgram",
    "one must select Deepgram",
  );
  for (const value of ["0", "", "true", "yes", " 1 ", undefined, null]) {
    assert(
      selectCoachSttProvider(value) === "assemblyai",
      `${String(value)} must safely select AssemblyAI`,
    );
  }
});

Deno.test("Deepgram grant uses permanent key only in authorization header", async () => {
  const permanentKey = "server-only-permanent-key";
  let request: { input: string; init?: RequestInit } | null = null;
  const token = await mintDeepgramAccessToken(
    permanentKey,
    (input, init) => {
      request = { input: String(input), init };
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "temporary-jwt", expires_in: 60 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    },
  );
  const captured = request as { input: string; init?: RequestInit } | null;
  assert(captured, "grant request was not captured");
  assert(
    captured.input === "https://api.deepgram.com/v1/auth/grant",
    "wrong grant endpoint",
  );
  assert(captured.init?.method === "POST", "grant must use POST");
  assert(
    (captured.init?.headers as Record<string, string>).Authorization ===
      `Token ${permanentKey}`,
    "grant must authorize server-side",
  );
  assert(
    String(captured.init?.body).includes('"ttl_seconds":60'),
    "TTL must be 60 seconds",
  );
  assert(token.token === "temporary-jwt", "client token must be temporary");
  assert(
    !JSON.stringify(token).includes(permanentKey),
    "permanent key must never appear in the returned payload",
  );
});

Deno.test("Deepgram provider configuration is normalized for PCM16 mono", () => {
  assert(DEEPGRAM_STREAMING_CONFIG.model === "nova-3", "wrong Deepgram model");
  assert(DEEPGRAM_STREAMING_CONFIG.sample_rate === 16_000, "wrong sample rate");
  assert(DEEPGRAM_STREAMING_CONFIG.channels === 1, "wrong channel count");
});

Deno.test("Deepgram authorization failure returns controlled AssemblyAI fallback", async () => {
  const result = await resolveCoachSttAuthorization({
    flag: "1",
    mintDeepgram: () =>
      Promise.reject(new Error("provider detail must stay private")),
    mintAssembly: () => Promise.resolve({ token: "assembly-temporary" }),
  });
  assert(result.selected === "assemblyai", "fallback must select AssemblyAI");
  assert(result.fallback, "fallback directive must be explicit");
  assert(
    result.assembly?.token === "assembly-temporary",
    "fallback must contain an AssemblyAI temporary token",
  );
  assert(
    !JSON.stringify(result).includes("provider detail"),
    "provider failure detail leaked into client response",
  );
});
