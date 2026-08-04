import {
  COACH_IDEMPOTENT_TOOLS,
  COACH_READ_ONLY_TOOLS,
  GENERATED_COACH_TOOL_REGISTRY,
  generatedRealtimeTools,
  validateCoachToolArguments,
} from "./generated/coachTools.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("generated coach registry has unique names and complete execution metadata", () => {
  const names = GENERATED_COACH_TOOL_REGISTRY.map((tool) => tool.name);
  assert(new Set(names).size === names.length, "coach tool names must be unique");
  assert(
    GENERATED_COACH_TOOL_REGISTRY.every(
      (tool) => tool.capability && tool.execution && tool.kind
    ),
    "every coach tool needs routing and execution metadata"
  );
  assert(
    generatedRealtimeTools().every((tool) =>
      GENERATED_COACH_TOOL_REGISTRY.some(
        (candidate) => candidate.name === tool.name && candidate.realtime
      )
    ),
    "only realtime tools may be exposed to the model"
  );
});

Deno.test("coach argument validation rejects malformed and unknown fields", () => {
  assert(
    !validateCoachToolArguments("record_makes", { count: 0 }).ok,
    "shot counts must be positive"
  );
  assert(
    !validateCoachToolArguments("set_shooting_total", {
      set_number: 1,
      makes: 8,
      attempts: 4,
    }).ok,
    "makes cannot exceed attempts"
  );
  assert(
    !validateCoachToolArguments("start_timer", { seconds: 30, minutes: 30 }).ok,
    "timer units must be unambiguous"
  );
  assert(
    !validateCoachToolArguments("get_progress", { invented: true }).ok,
    "unknown fields must be rejected"
  );
  assert(
    validateCoachToolArguments("set_timed_set_duration", {
      set_number: 2,
      duration_seconds: 30,
      client_request_id: "request-123",
    }).ok,
    "valid generated arguments should pass"
  );
});

Deno.test("server mutation and read sets derive from the canonical registry", () => {
  for (const tool of GENERATED_COACH_TOOL_REGISTRY) {
    if (tool.execution !== "server") continue;
    if (tool.kind === "read_only") {
      assert(COACH_READ_ONLY_TOOLS.has(tool.name), `${tool.name} missing from read set`);
    } else {
      assert(COACH_IDEMPOTENT_TOOLS.has(tool.name), `${tool.name} missing from mutation set`);
    }
  }
});
