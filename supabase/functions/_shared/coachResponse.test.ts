import {
  assessCoachSpeech,
  buildAnthropicConversationMessages,
  buildAnthropicSystemBlocks,
  buildAnthropicTools,
  coachToolFailureSpeech,
  coachToolPreamble,
  consumeAnthropicSse,
  consumeResponsesSse,
  createAbortTimeout,
  inferCoachResponseCapabilities,
  isCurrentShootingCorrectionRequest,
  isCoachMutationRequest,
  isConfidentlyToolFreeCoachRequest,
  resolveCoachToolContinuation,
  sanitizeCoachConversationSummary,
  selectCoachResponseModel,
  successfulCoachToolConfirmation,
  shouldForceCoachTool,
  usesOptimisticToolPreamble,
  validateCoachTurnRequest,
} from "./coachResponse.ts";
import { COACH_TURN_STABLE_SYSTEM_PROMPT } from "./coachCore.ts";
import { generatedResponseTools } from "./generated/coachTools.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("coach turn validation bounds identity and transcript fields", () => {
  const valid = validateCoachTurnRequest({
    day_id: "day-1",
    session_key: "session-key-123456789",
    turn_id: "turn-12345678",
    transcript: "How should I improve?",
    state_version: 4,
  });
  assert(valid.ok, "expected valid coach turn");
  assert(
    valid.value.mode === "standard",
    "omitted mode should remain standard",
  );
  const invalid = validateCoachTurnRequest({
    day_id: "day-1",
    session_key: "short",
    turn_id: "bad turn",
    transcript: "",
    state_version: -1,
  });
  assert(!invalid.ok, "expected invalid coach turn");
});

Deno.test("coach turn validation accepts only the explicit safe speculative mode", () => {
  const speculative = validateCoachTurnRequest({
    day_id: "day-1",
    session_key: "session-key-123456789",
    turn_id: "turn-12345678",
    transcript: "What is your name?",
    state_version: 4,
    mode: "speculative_read_only",
  });
  assert(
    speculative.ok && speculative.value.mode === "speculative_read_only",
    "expected explicit speculative read-only mode",
  );
  const invalid = validateCoachTurnRequest({
    day_id: "day-1",
    session_key: "session-key-123456789",
    turn_id: "turn-12345678",
    transcript: "What is your name?",
    state_version: 4,
    mode: "read_write",
  });
  assert(!invalid.ok, "unknown modes must be rejected");
});

Deno.test("every model turn uses Haiku without extended reasoning", () => {
  assert(
    selectCoachResponseModel("Tell me about this drill").model ===
      "claude-haiku-4-5-20251001",
    "simple question should use Haiku",
  );
  assert(
    selectCoachResponseModel("Analyze my performance and weaknesses").model ===
      "claude-haiku-4-5-20251001",
    "analysis should stay on Haiku",
  );
  assert(
    selectCoachResponseModel("Rebuild my whole workout").reasoningEffort ===
      "none",
    "broad mutations should disable reasoning",
  );
});

Deno.test("response tool routing narrows clear requests without removing ambiguous abilities", () => {
  const timerCapabilities = inferCoachResponseCapabilities(
    "Change this set timer to thirty seconds",
  );
  assert(
    timerCapabilities.includes("timers"),
    "timer request should include timer tools",
  );
  assert(
    timerCapabilities.includes("edits"),
    "timer change should include edit tools",
  );
  assert(
    !timerCapabilities.includes("notes"),
    "clear timer request should omit note tools",
  );
  assert(
    inferCoachResponseCapabilities("Help me with this").length === 8,
    "ambiguous requests should retain the complete tool catalog",
  );
});

Deno.test("mutation turns and contextual confirmations force a silent tool-first round", () => {
  assert(
    isCurrentShootingCorrectionRequest(
      "Coach, I actually think I missed the last one",
    ),
    "last-shot corrections must be identified as score mutations",
  );
  assert(
    shouldForceCoachTool("Coach, I actually think I missed the last one"),
    "last-shot corrections must force a native Coach tool call",
  );
  assert(
    shouldForceCoachTool("Add low pound dribbles"),
    "explicit mutations should force a tool",
  );
  assert(
    shouldForceCoachTool(
      "yes",
      "Coach: Form Shooting isn't in this workout. Do you want me to add it?",
    ),
    "an affirmative follow-up should use recent conversation",
  );
  assert(
    isCoachMutationRequest(
      "yeah",
      "Coach: Would you like me to add Form Shooting?",
    ),
    "contextual confirmations should remain mutation turns",
  );
  assert(
    !isCoachMutationRequest(
      "yeah",
      "Coach: Do you want me to add Form Shooting?\nUser: no\nCoach: What next?",
    ),
    "an old question should not hijack a new one-word response",
  );
  assert(
    shouldForceCoachTool("Show me some finishing drills"),
    "search and list requests should suppress pre-tool speech",
  );
  assert(
    !shouldForceCoachTool("What is your name?"),
    "questions about the coach should remain conversational",
  );
});

Deno.test("tool-free routing is narrow and excludes state or mutation requests", () => {
  assert(
    isConfidentlyToolFreeCoachRequest("What is your name?"),
    "coach identity is confidently conversational",
  );
  assert(
    isConfidentlyToolFreeCoachRequest("Motivate me"),
    "bounded motivation is confidently conversational",
  );
  assert(
    isConfidentlyToolFreeCoachRequest("How can I improve my dribbling?"),
    "generic technique advice does not require workout state or tools",
  );
  assert(
    !isConfidentlyToolFreeCoachRequest("How am I doing today?"),
    "potential workout-state questions must retain tools",
  );
  assert(
    !isConfidentlyToolFreeCoachRequest("Add a shooting drill"),
    "mutations must retain tools",
  );
  assert(
    !isConfidentlyToolFreeCoachRequest(
      "yes",
      "Coach: Do you want me to add Form Shooting?",
    ),
    "contextual mutation confirmations must retain tools",
  );
});

Deno.test("provider timeout combines deadlines with client cancellation", async () => {
  const parent = new AbortController();
  const deadline = createAbortTimeout(parent.signal, 10);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert(deadline.signal.aborted, "deadline should abort the provider signal");
  assert(deadline.didTimeout(), "deadline should report provider timeout");
  deadline.dispose();

  const client = new AbortController();
  const clientDeadline = createAbortTimeout(client.signal, 1_000);
  client.abort();
  assert(clientDeadline.signal.aborted, "client abort should propagate");
  assert(
    !clientDeadline.didTimeout(),
    "client abort is not a provider timeout",
  );
  clientDeadline.dispose();
});

Deno.test("Anthropic caching marks the stable prefix and preserves ordered history", () => {
  const blocks = buildAnthropicSystemBlocks("stable", "dynamic");
  assert(blocks.length === 2, "expected stable and dynamic system blocks");
  assert(
    JSON.stringify(blocks[0].cache_control) === '{"type":"ephemeral"}',
    "the stable tools and system prefix must have an explicit cache breakpoint",
  );
  assert(
    !("cache_control" in blocks[1]),
    "the changing workout context must remain outside the explicit breakpoint",
  );
  const stablePrefixCharacters =
    COACH_TURN_STABLE_SYSTEM_PROMPT.length +
    JSON.stringify(buildAnthropicTools(generatedResponseTools())).length;
  assert(
    stablePrefixCharacters >= 16_384,
    "the stable tools and system prefix must comfortably exceed Haiku's 4K-token cache minimum",
  );
  const messages = buildAnthropicConversationMessages(
    "User: Start the timer\nCoach: A timer is ready.\nUser: yes",
    "Start it now",
  );
  assert(
    JSON.stringify(messages) ===
      '[{"role":"user","content":"Start the timer"},{"role":"assistant","content":"A timer is ready."},{"role":"user","content":"yes\\nStart it now"}]',
    "prior messages must retain their order and only the newest user input is appended",
  );
});

Deno.test("Anthropic adapter preserves every native tool and input schema", () => {
  const canonical = generatedResponseTools();
  const anthropic = buildAnthropicTools(canonical);
  assert(
    anthropic.length === canonical.length && anthropic.length > 10,
    "all standard server tools must remain available",
  );
  for (const [index, tool] of anthropic.entries()) {
    assert(
      tool.name === canonical[index].name &&
        tool.input_schema === canonical[index].parameters,
      "Anthropic tools must retain canonical names and schemas",
    );
    assert(
      !("type" in tool) && !("parameters" in tool) && !("strict" in tool),
      "OpenAI-only tool fields must not enter the Anthropic request",
    );
  }
});

Deno.test("tool continuation honors exact speech and skip-model precedence", () => {
  const exact = resolveCoachToolContinuation({
    continuation: "speak_exact",
    say: "Done.",
  });
  assert(
    exact.type === "speak_exact" && exact.speech === "Done.",
    "speak_exact should bypass synthesis with exact tool speech",
  );
  assert(
    resolveCoachToolContinuation({
      continuation: "speak_exact",
      say: "Do not speak this",
      skip_model_response: true,
    }).type === "none",
    "skip_model_response should suppress a model continuation",
  );
  assert(
    resolveCoachToolContinuation({ continuation: "model" }).type === "model",
    "read-only tool results should continue through the model",
  );
  assert(
    resolveCoachToolContinuation({
      continuation: "speak_exact",
      say: "function call equals invoke",
    }).type === "model",
    "unsafe exact tool output must never bypass model synthesis",
  );
});

Deno.test("catalog search preamble is natural and additions name the selected drill", () => {
  assert(
    coachToolPreamble("search_exercise_catalog", {
      query: "search the exercise catalog for V dribble drills",
    }) === "I'm searching for V dribble.",
    "search preamble should speak only the compact drill reference",
  );
  assert(
    coachToolPreamble("start_timer", {}) === "I'm starting the timer.",
    "timer mutations should have a short athlete-facing preamble",
  );
  assert(
    coachToolPreamble("add_workout_exercise", {
      exercise_name: "V Dribble Series",
    }) === "I'm adding V Dribble Series.",
    "drill additions should name the selected drill",
  );
  assert(
    coachToolPreamble("get_progress", {}) === null,
    "read tools should remain silent",
  );
  assert(
    coachToolPreamble("set_current_drill", {}) === null &&
      coachToolPreamble("skip_drill", {}) === null,
    "navigation must reserve its single athlete-facing response for the completed move",
  );
});

Deno.test("timer duration changes wait for the completed timer-start offer", () => {
  assert(
    coachToolPreamble("set_timed_set_duration", { duration_seconds: 45 }) === null,
    "duration changes should wait for their saved result before speaking",
  );
  assert(
    !usesOptimisticToolPreamble("set_timed_set_duration") &&
      !usesOptimisticToolPreamble("get_progress"),
    "duration changes should retain their completed timer-start offer",
  );
  assert(
    coachToolFailureSpeech("set_timed_set_duration") ===
      "Couldn't change it. Try again.",
    "failed duration changes should have one concise fallback",
  );
});

Deno.test("completed tool actions retain a safe exact confirmation", () => {
  assert(
    successfulCoachToolConfirmation({
      result: "A 1-minute timer has been started.",
      client_action: { type: "start_timer" },
    }) === "A 1-minute timer has been started.",
    "client timer actions should have a usable degraded-success confirmation",
  );
  assert(
    successfulCoachToolConfirmation({
      result: 'Added V dribbles.',
      db_changed: true,
    }) === "Added V dribbles.",
    "committed drill additions should have a usable degraded-success confirmation",
  );
  assert(
    successfulCoachToolConfirmation({
      result: "Error: failed to add drill",
      db_changed: true,
    }) === null,
    "error-shaped results must never be spoken as a success",
  );
});

Deno.test("speech gate rejects pseudo calls and private reasoning", () => {
  for (
    const unsafe of [
      "function call equals invoke",
      '<function_calls><invoke name="get_progress"></invoke></function_calls>',
      'tool_use {"name":"get_progress","input":{}}',
      'recipient=coach_tools arguments={"view":"progress"}',
      "Analysis: I should call the workout tool first.",
      "I need to invoke the function before answering.",
    ]
  ) {
    assert(
      !assessCoachSpeech(unsafe).ok,
      `must reject unsafe speech: ${unsafe}`,
    );
  }
  const safe = assessCoachSpeech(
    "You're three for five, with five shots left.",
  );
  assert(
    safe.ok && safe.text === "You're three for five, with five shots left.",
    "ordinary athlete-facing speech must remain available",
  );
});

Deno.test("contaminated model syntax is removed from conversation memory", () => {
  const clean = sanitizeCoachConversationSummary(
    "User: Find V dribble\nCoach: function call = invoke search_exercise_catalog\nUser: yes",
  );
  assert(
    clean === "User: Find V dribble\nUser: yes",
    "unsafe prior model text should not be sent back to the provider",
  );
});

Deno.test("Responses SSE parser handles split chunks and tool calls", async () => {
  const payload = [
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-1","name":"get_progress","arguments":"{}"}}\n\n',
    'data: {"type":"response.completed","response":{"id":"resp-1","usage":{"input_tokens":2}}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 31));
      controller.enqueue(bytes.slice(31, 117));
      controller.enqueue(bytes.slice(117));
      controller.close();
    },
  });
  let text = "";
  let tool = "";
  let responseId: string | null = null;
  await consumeResponsesSse(stream, {
    onTextDelta(delta) {
      text += delta;
    },
    onFunctionCall(call) {
      tool = call.name;
    },
    onCompleted(id) {
      responseId = id;
    },
  });
  assert(text === "Hello", "expected text delta");
  assert(tool === "get_progress", "expected function call");
  assert(responseId === "resp-1", "expected completion");
});

Deno.test("Anthropic SSE parser streams text, tool JSON, and usage", async () => {
  const payload = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":12}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ready"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"get_progress","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"set_number\\":"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"2}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7,"service_tier":"standard"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join("");
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 91));
      controller.enqueue(bytes.slice(91, 313));
      controller.enqueue(bytes.slice(313));
      controller.close();
    },
  });
  let text = "";
  let toolName = "";
  let toolArguments = "";
  let completedOutputTokens = 0;
  let completedStopReason = "";
  await consumeAnthropicSse(stream, {
    onTextDelta(delta) {
      text += delta;
    },
    onFunctionCall(call) {
      toolName = call.name;
      toolArguments = call.argumentsJson;
    },
    onCompleted(_id, usage) {
      completedOutputTokens = Number(usage?.output_tokens ?? 0);
      completedStopReason = String(usage?.stop_reason ?? "");
    },
  });
  assert(text === "Ready", "expected streamed Anthropic text");
  assert(toolName === "get_progress", "expected Anthropic tool call");
  assert(
    toolArguments === '{"set_number":2}',
    "expected accumulated Anthropic tool JSON",
  );
  assert(completedOutputTokens === 7, "expected cumulative usage");
  assert(completedStopReason === "tool_use", "expected Anthropic stop reason");
});

Deno.test("Anthropic SSE parser rejects orphaned text and incomplete tools", async () => {
  const cases = [
    [
      'data: {"type":"message_start","message":{"id":"msg-orphan"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"function call equals invoke"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join(""),
    [
      'data: {"type":"message_start","message":{"id":"msg-partial"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"get_progress","input":{}}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}\n\n',
    ].join(""),
  ];
  for (const payload of cases) {
    let rejected = false;
    try {
      await consumeAnthropicSse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(payload));
            controller.close();
          },
        }),
        {
          onTextDelta() {},
          onFunctionCall() {},
          onCompleted() {},
        },
      );
    } catch {
      rejected = true;
    }
    assert(rejected, "malformed Anthropic streams must fail closed");
  }
});
