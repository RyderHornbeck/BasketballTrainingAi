import {
  COACH_SERVER_TOOL_NAMES,
  generatedResponseTools,
  validateCoachToolArguments,
} from "./coachTools.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("generated coach contracts reject unsafe tool arguments", () => {
  const unknown = validateCoachToolArguments("not_a_tool", {});
  assert(!unknown.ok, "unknown tool should be rejected");
  const extra = validateCoachToolArguments("get_progress", { admin: true });
  assert(!extra.ok, "unexpected property should be rejected");
  const bounds = validateCoachToolArguments("save_shooting_results", {
    set_number: 1,
    makes: 11,
    attempts: 10,
  });
  assert(!bounds.ok, "makes above attempts should be rejected");
});

Deno.test("navigation accepts an authoritative exercise ID without a duplicate name", () => {
  const navigation = validateCoachToolArguments("set_current_position", {
    exercise_id: "exercise-123",
  });
  assert(
    navigation.ok,
    "navigation should accept the authoritative ID supplied in workout state",
  );
});

Deno.test("Responses contracts expose only validated server tools", () => {
  const tools = generatedResponseTools();
  assert(tools.length > 0, "expected Responses tools");
  assert(
    tools.every((tool) => tool.type === "function" && tool.strict === false),
    "expected Responses-compatible function definitions"
  );
  assert(
    !tools.some((tool) => tool.name === "update_shots"),
    "client-only tools must never be exposed to the backend agent"
  );
  assert(
    tools.some((tool) => tool.name === "set_shooting_set_targets"),
    "expected bounded workout mutation tools"
  );
  assert(
    tools.some((tool) => tool.name === "search_exercise_catalog") &&
      tools.some((tool) => tool.name === "add_workout_exercise"),
    "standard turn contracts must retain catalog search and add tools"
  );
  assert(
    new Set(tools.map((tool) => tool.name)).size === COACH_SERVER_TOOL_NAMES.size &&
      [...COACH_SERVER_TOOL_NAMES].every((name) =>
        tools.some((tool) => tool.name === name)
      ),
    "every executable server tool must be available to the Anthropic coach"
  );
});

