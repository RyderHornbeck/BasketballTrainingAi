export type CoachCapability =
  | "shots"
  | "reads"
  | "navigation"
  | "timers"
  | "completion"
  | "edits"
  | "recommendations"
  | "notes";

type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: false;
};

export interface CoachToolSpec {
  name: string;
  description: string;
  capability: CoachCapability;
  execution: "client" | "server";
  kind: "read_only" | "mutation";
  realtime: boolean;
  flushShots?: boolean;
  exactSpeech?: boolean;
  parameters: JsonSchema;
}

const drillReference = {
  exercise_id: { type: "string" },
  drill_name: { type: "string" },
};
const setReference = {
  ...drillReference,
  set_number: { type: "integer", minimum: 1, maximum: 100 },
};
const empty = (): JsonSchema => ({
  type: "object",
  properties: {},
  additionalProperties: false,
});
const args = (
  properties: JsonSchema["properties"],
  required: string[] = []
): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const tool = (
  spec: Omit<CoachToolSpec, "parameters"> & { parameters?: JsonSchema }
): CoachToolSpec => ({ ...spec, parameters: spec.parameters ?? empty() });

export const COACH_TOOL_REGISTRY: readonly CoachToolSpec[] = [
  tool({
    name: "record_make",
    description: "Record exactly one made shot.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(setReference),
  }),
  tool({
    name: "record_miss",
    description: "Record exactly one missed shot.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(setReference),
  }),
  tool({
    name: "record_makes",
    description: "Add N makes and N attempts.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      { ...setReference, count: { type: "integer", minimum: 1, maximum: 500 } },
      ["count"]
    ),
  }),
  tool({
    name: "record_misses",
    description: "Add N misses and N attempts.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      { ...setReference, count: { type: "integer", minimum: 1, maximum: 500 } },
      ["count"]
    ),
  }),
  tool({
    name: "add_shooting_result",
    description: "Add an explicitly incremental X-for-Y result.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        makes: { type: "integer", minimum: 0, maximum: 500 },
        attempts: { type: "integer", minimum: 1, maximum: 500 },
      },
      ["makes", "attempts"]
    ),
  }),
  tool({
    name: "set_shooting_total",
    description: "Replace one set's actual cumulative X-for-Y progress.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        makes: { type: "integer", minimum: 0, maximum: 500 },
        attempts: { type: "integer", minimum: 0, maximum: 500 },
        completed: { type: "boolean" },
      },
      ["makes", "attempts", "set_number"]
    ),
  }),
  tool({
    name: "save_shooting_results",
    description: "Persist actual cumulative shooting results.",
    capability: "shots",
    execution: "server",
    kind: "mutation",
    realtime: false,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        makes: { type: "integer", minimum: 0, maximum: 500 },
        attempts: { type: "integer", minimum: 0, maximum: 500 },
        completed: { type: "boolean" },
        client_request_id: { type: "string", minLength: 8, maxLength: 200 },
        expected_exercise_id: { type: "string" },
        expected_set_number: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["makes", "attempts", "set_number"]
    ),
  }),
  tool({
    name: "get_workout_position",
    description: "Fetch the complete authoritative workout snapshot.",
    capability: "reads",
    execution: "server",
    kind: "read_only",
    realtime: true,
  }),
  tool({
    name: "get_next_drill",
    description: "Fetch the next incomplete work item.",
    capability: "reads",
    execution: "server",
    kind: "read_only",
    realtime: false,
  }),
  tool({
    name: "get_progress",
    description: "Fetch workout progress.",
    capability: "reads",
    execution: "server",
    kind: "read_only",
    realtime: true,
  }),
  tool({
    name: "list_workout_drills",
    description: "List workout drills, optionally by category.",
    capability: "reads",
    execution: "server",
    kind: "read_only",
    realtime: true,
    parameters: args({ category: { type: "string", maxLength: 80 } }),
  }),
  tool({
    name: "set_current_position",
    description:
      "The only navigation tool. Select a drill and optionally one of its unfinished sets without changing results or completion. Omit set_number to select that drill's next incomplete set.",
    capability: "navigation",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: false,
    parameters: args({
      ...drillReference,
      set_number: { type: "integer", minimum: 1, maximum: 100 },
    }),
  }),
  tool({
    name: "set_set_completion",
    description:
      "Complete or reopen exactly one set. Explicit completion keeps existing shooting or finishing progress and does not require new makes or attempts.",
    capability: "completion",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        completed: { type: "boolean" },
        confirmed_incomplete: { type: "boolean" },
      },
      ["set_number", "completed"]
    ),
  }),
  tool({
    name: "complete_drill",
    description: "Complete a whole drill only when actual shooting results already exist.",
    capability: "completion",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args(drillReference),
  }),
  tool({
    name: "uncomplete_drill",
    description: "Reopen a whole drill.",
    capability: "completion",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args(drillReference),
  }),
  tool({
    name: "reopen_workout",
    description: "Reopen a completed workout day.",
    capability: "completion",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
  }),
  tool({
    name: "start_timer",
    description:
      "Start a timer bound to a specific workout set whenever one is active or named; preserve seconds and minutes exactly.",
    capability: "timers",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args({
      ...setReference,
      minutes: { type: "number", exclusiveMinimum: 0, maximum: 180 },
      seconds: { type: "number", exclusiveMinimum: 0, maximum: 10800 },
      duration_confirmation_token: { type: "string", maxLength: 240 },
    }),
  }),
  tool({
    name: "get_timer_status",
    description:
      "Get the exact live timer status from the athlete's device when they ask about time left, current timer time, or whether it is running or paused.",
    capability: "timers",
    execution: "server",
    kind: "read_only",
    realtime: true,
    exactSpeech: true,
  }),
  tool({
    name: "pause_timer",
    description: "Pause the timer.",
    capability: "timers",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
  }),
  tool({
    name: "resume_timer",
    description: "Resume the timer.",
    capability: "timers",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
  }),
  tool({
    name: "stop_timer",
    description: "Stop and reset the timer.",
    capability: "timers",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
  }),
  tool({
    name: "set_timed_set_duration",
    description: "Change one timed set's prescribed duration.",
    capability: "timers",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        duration_seconds: { type: "integer", minimum: 5, maximum: 3600 },
      },
      ["set_number", "duration_seconds"]
    ),
  }),
  tool({
    name: "set_shooting_set_targets",
    description:
      "Change one shooting or finishing set's targets, never its results. Must be called for an explicit request to shoot a different number of shots, such as 'I want to shoot 50 shots.'",
    capability: "edits",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...setReference,
      target_makes: { type: "integer", minimum: 0, maximum: 500 },
      target_attempts: { type: "integer", minimum: 1, maximum: 500 },
    }, ["set_number"]),
  }),
  tool({
    name: "search_exercise_catalog",
    description:
      "Search active exercises to offer options. After the athlete accepts or selects a displayed option by name or number, add that exact option directly without re-searching or asking another confirmation. Result IDs are internal; present names only and never ask the athlete for an ID.",
    capability: "recommendations",
    execution: "server",
    kind: "read_only",
    realtime: true,
    parameters: args(
      {
        query: { type: "string", minLength: 1, maxLength: 160 },
        confirmation_token: { type: "string", maxLength: 240 },
      },
      ["query"]
    ),
  }),
  tool({
    name: "add_workout_exercise",
    description:
      "Add one exact displayed catalog exercise after the athlete accepts it or selects it by name or number. Do not re-search or ask another confirmation. Never ask the athlete for a catalog ID.",
    capability: "edits",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      {
        exercise_name: { type: "string", minLength: 1, maxLength: 160 },
        catalog_exercise_id: { type: "string" },
        catalog_search_token: { type: "string", maxLength: 240 },
      },
      ["exercise_name"]
    ),
  }),
  tool({
    name: "remove_workout_exercise",
    description: "Remove one drill after explicit confirmation.",
    capability: "edits",
    execution: "server",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...drillReference,
      confirmation_token: { type: "string", maxLength: 240 },
    }),
  }),
  tool({
    name: "save_note",
    description: "Append a short note to one drill.",
    capability: "notes",
    execution: "server",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      { ...drillReference, note: { type: "string", minLength: 1, maxLength: 500 } },
      ["note"]
    ),
  }),
  tool({
    name: "update_shots",
    description:
      "Record actual shots for one set. Use add for new shots and replace only for an explicit cumulative correction. Do not use for targets.",
    capability: "shots",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      {
        ...setReference,
        operation: { type: "string", enum: ["add", "replace"] },
        makes: { type: "integer", minimum: 0, maximum: 500 },
        attempts: { type: "integer", minimum: 1, maximum: 500 },
        completed: { type: "boolean" },
      },
      ["operation", "makes", "attempts", "set_number"]
    ),
  }),
  tool({
    name: "get_workout_state",
    description:
      "Read workout facts. Use position for current/next work, progress for statistics, and list for drill names. Do not guess from earlier conversation.",
    capability: "reads",
    execution: "client",
    kind: "read_only",
    realtime: true,
    parameters: args({
      view: { type: "string", enum: ["position", "progress", "list"] },
      category: { type: "string", maxLength: 80 },
    }, ["view"]),
  }),
  tool({
    name: "navigate_workout",
    description:
      "Move within the workout without changing results. Use go_to for a named/relative drill and skip for the current drill.",
    capability: "navigation",
    execution: "client",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...drillReference,
      action: { type: "string", enum: ["go_to", "skip"] },
    }, ["action"]),
  }),
  tool({
    name: "update_completion",
    description:
      "Complete or reopen a set, drill, or workout. Do not use skip as completion. Missing shooting results must be collected first.",
    capability: "completion",
    execution: "client",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...setReference,
      scope: { type: "string", enum: ["set", "drill", "workout"] },
      completed: { type: "boolean" },
      confirmation_token: { type: "string", maxLength: 32 },
    }, ["scope", "completed"]),
  }),
  tool({
    name: "control_timer",
    description:
      "Start, pause, resume, or stop the timer. Use seconds exactly. A changed timed-set duration requires confirmation first.",
    capability: "timers",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args({
      action: { type: "string", enum: ["start", "pause", "resume", "stop"] },
      seconds: { type: "integer", minimum: 5, maximum: 10800 },
      duration_confirmation_token: { type: "string", maxLength: 32 },
    }, ["action"]),
  }),
  tool({
    name: "update_set_prescription",
    description:
      "Change one set's prescribed duration or shooting targets. Never change observed results.",
    capability: "edits",
    execution: "client",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...setReference,
      duration_seconds: { type: "integer", minimum: 5, maximum: 3600 },
      target_makes: { type: "integer", minimum: 0, maximum: 500 },
      target_attempts: { type: "integer", minimum: 1, maximum: 500 },
    }, ["set_number"]),
  }),
  tool({
    name: "search_exercises",
    description:
      "Search the exercise catalog for recommendations or a confirmed addition. Do not add anything.",
    capability: "recommendations",
    execution: "client",
    kind: "read_only",
    realtime: true,
    parameters: args(
      { query: { type: "string", minLength: 1, maxLength: 160 } },
      ["query"]
    ),
  }),
  tool({
    name: "add_exercise",
    description:
      "Add one exercise returned by search_exercises after the athlete explicitly confirms.",
    capability: "edits",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args(
      { catalog_exercise_id: { type: "string" } },
      ["catalog_exercise_id"]
    ),
  }),
  tool({
    name: "remove_exercise",
    description:
      "Remove one workout drill and its analytics only after explicit confirmation. Never remove the final drill.",
    capability: "edits",
    execution: "client",
    kind: "mutation",
    realtime: true,
    flushShots: true,
    exactSpeech: true,
    parameters: args({
      ...drillReference,
      confirmation_token: { type: "string", maxLength: 32 },
    }),
  }),
  tool({
    name: "change_workout_duration",
    description:
      "Extend or shorten the workout estimate by an explicit number of minutes.",
    capability: "edits",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args({
      action: { type: "string", enum: ["extend", "shorten"] },
      minutes: { type: "number", exclusiveMinimum: 0, maximum: 180 },
    }, ["action", "minutes"]),
  }),
  tool({
    name: "append_drill_note",
    description:
      "Append a short athlete note to the current or named drill. Do not replace prior notes.",
    capability: "notes",
    execution: "client",
    kind: "mutation",
    realtime: true,
    exactSpeech: true,
    parameters: args({
      ...drillReference,
      note: { type: "string", minLength: 1, maxLength: 500 },
    }, ["note"]),
  }),
] as const;

export const COACH_REALTIME_TOOL_NAMES = [
  "update_shots",
  "get_workout_state",
  "navigate_workout",
  "update_completion",
  "control_timer",
  "update_set_prescription",
  "search_exercises",
  "add_exercise",
  "remove_exercise",
  "change_workout_duration",
  "append_drill_note",
] as const;

export const COACH_CAPABILITY_ORDER: readonly CoachCapability[] = [
  "reads",
  "shots",
  "navigation",
  "timers",
  "completion",
  "edits",
  "recommendations",
  "notes",
];
