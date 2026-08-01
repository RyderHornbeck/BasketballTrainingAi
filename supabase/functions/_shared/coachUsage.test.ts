import {
  estimateRealtimeCostUsd,
  estimateTtsCostUsd,
  TTS_MAX_TEXT_LENGTH,
  validateTtsRequest,
} from "./coachUsage.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("validateTtsRequest accepts and trims bounded deterministic text", () => {
  const result = validateTtsRequest({
    text: "  Saved, eight of ten.  ",
    request_id: "shot-save:123",
    session_key: "session-key-123456789",
  });
  assert(result.ok, "expected a valid request");
  assert(result.value.text === "Saved, eight of ten.", "expected trimmed text");
});

Deno.test("validateTtsRequest rejects oversized and control-character text", () => {
  const common = {
    request_id: "request-123",
    session_key: "session-key-123456789",
  };
  const oversized = validateTtsRequest({
    ...common,
    text: "a".repeat(TTS_MAX_TEXT_LENGTH + 1),
  });
  assert(!oversized.ok, "expected oversized text rejection");

  const control = validateTtsRequest({ ...common, text: "Saved\u0000 now" });
  assert(!control.ok, "expected control-character rejection");
});

Deno.test("validateTtsRequest rejects unsafe identifiers", () => {
  const invalidRequest = validateTtsRequest({
    text: "Done.",
    request_id: "../../unsafe",
    session_key: "session-key-123456789",
  });
  assert(!invalidRequest.ok, "expected request id rejection");

  const shortSession = validateTtsRequest({
    text: "Done.",
    request_id: "request-123",
    session_key: "short",
  });
  assert(!shortSession.ok, "expected session key rejection");
});

Deno.test("estimateTtsCostUsd is positive, bounded, and monotonic", () => {
  const shortCost = estimateTtsCostUsd("Done.");
  const longCost = estimateTtsCostUsd(
    "Saved eight of ten. Move to the next drill and start the timer."
  );
  const maxCost = estimateTtsCostUsd("word ".repeat(60).trim());

  assert(shortCost > 0, "expected a positive minimum cost");
  assert(longCost > shortCost, "expected longer speech to cost more");
  assert(maxCost < 0.01, "a bounded TTS request should cost well below the daily cap");
});

Deno.test("Realtime cost estimation remains unchanged", () => {
  const cost = estimateRealtimeCostUsd({
    input_text_tokens: 1_000,
    cached_text_tokens: 200,
    input_audio_tokens: 500,
    cached_audio_tokens: 100,
    output_text_tokens: 250,
    output_audio_tokens: 300,
  });
  const expected =
    800 * (0.6 / 1_000_000) +
    200 * (0.06 / 1_000_000) +
    400 * (10 / 1_000_000) +
    100 * (0.30 / 1_000_000) +
    250 * (2.4 / 1_000_000) +
    300 * (20 / 1_000_000);
  assert(Math.abs(cost - expected) < 1e-12, "expected existing Realtime rates");
});
