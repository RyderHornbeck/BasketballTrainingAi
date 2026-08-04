import {
  parseCompactWorkoutContext,
  validateCoachAgentSessionRequest,
} from "./cartesiaSession.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const VALID_REQUEST = {
  day_id: "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
  session_key: "coach-session-123456789",
};

Deno.test("coach agent session validation supplies stable defaults", () => {
  const result = validateCoachAgentSessionRequest(VALID_REQUEST);
  assert(result.ok, "expected valid bootstrap");
  assert(result.value.voicePersona === "tyler", "expected default persona");
  assert(result.value.stateVersion === 0, "expected initial state version");
});

Deno.test("coach agent session validation bounds client state", () => {
  const valid = validateCoachAgentSessionRequest({
    ...VALID_REQUEST,
    voice_persona: "ava",
    state_version: 17,
    conversation_summary: "  Finished the warmup.  ",
    timer: { running: true, elapsed_seconds: 12.9 },
  });
  assert(valid.ok, "expected valid bounded state");
  assert(valid.value.stateVersion === 17, "expected supplied state version");
  assert(valid.value.timer?.elapsed_seconds === 12, "expected integer timer");
  assert(
    valid.value.conversationSummary === "Finished the warmup.",
    "expected trimmed summary",
  );

  const invalid = validateCoachAgentSessionRequest({
    ...VALID_REQUEST,
    voice_persona: "raw-provider-voice",
  });
  assert(!invalid.ok, "expected raw provider voice rejection");
});

Deno.test("coach agent session validation rejects unsafe identifiers and payloads", () => {
  const badDay = validateCoachAgentSessionRequest({
    ...VALID_REQUEST,
    day_id: "../../workout",
  });
  assert(!badDay.ok, "expected malformed day rejection");

  const badKey = validateCoachAgentSessionRequest({
    ...VALID_REQUEST,
    session_key: "coach/session/../../unsafe",
  });
  assert(!badKey.ok, "expected unsafe session key rejection");

  const longSummary = validateCoachAgentSessionRequest({
    ...VALID_REQUEST,
    conversation_summary: "x".repeat(2_001),
  });
  assert(!longSummary.ok, "expected oversized summary rejection");
});

Deno.test("compact workout context must remain an object", () => {
  const parsed = parseCompactWorkoutContext('{"workout_day":{"title":"Handles"}}');
  assert(
    (parsed.workout_day as { title?: string }).title === "Handles",
    "expected parsed context",
  );

  let rejected = false;
  try {
    parseCompactWorkoutContext("[]");
  } catch {
    rejected = true;
  }
  assert(rejected, "expected non-object context rejection");
});
