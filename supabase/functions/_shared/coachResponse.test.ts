import {
  buildAnthropicSystemBlocks,
  consumeAnthropicSse,
  consumeResponsesSse,
  createAbortTimeout,
  inferCoachResponseCapabilities,
  isConfidentlyToolFreeCoachRequest,
  isCoachMutationRequest,
  resolveCoachToolContinuation,
  selectCoachResponseModel,
  shouldForceCoachTool,
  validateCoachTurnRequest,
} from "./coachResponse.ts";

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
  assert(valid.value.mode === "standard", "omitted mode should remain standard");
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
  assert(!clientDeadline.didTimeout(), "client abort is not a provider timeout");
  clientDeadline.dispose();
});

Deno.test("Anthropic caching only applies to a naturally large stable prefix", () => {
  const blocks = buildAnthropicSystemBlocks("stable", "dynamic");
  assert(blocks.length === 2, "expected stable and dynamic system blocks");
  assert(
    !("cache_control" in blocks[0]),
    "small voice policy must not be padded just for cache eligibility",
  );
  const cacheableBlocks = buildAnthropicSystemBlocks("x".repeat(16_384), "dynamic");
  assert(
    JSON.stringify(cacheableBlocks[0].cache_control) ===
      '{"type":"ephemeral","ttl":"1h"}',
    "naturally large stable prefix should use the one-hour cache",
  );
  assert(
    !("cache_control" in blocks[1]),
    "dynamic context must remain uncached",
  );
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
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ready"}}\n\n',
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
