import {
  consumeResponsesSse,
  selectCoachResponseModel,
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
  const invalid = validateCoachTurnRequest({
    day_id: "day-1",
    session_key: "short",
    turn_id: "bad turn",
    transcript: "",
    state_version: -1,
  });
  assert(!invalid.ok, "expected invalid coach turn");
});

Deno.test("model routing reserves Terra for analysis and broad edits", () => {
  assert(
    selectCoachResponseModel("Tell me about this drill").model === "gpt-5.6-luna",
    "simple question should use Luna"
  );
  assert(
    selectCoachResponseModel("Analyze my performance and weaknesses").model ===
      "gpt-5.6-terra",
    "analysis should use Terra"
  );
  assert(
    selectCoachResponseModel("Rebuild my whole workout").reasoningEffort === "low",
    "broad mutation should use low reasoning"
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

