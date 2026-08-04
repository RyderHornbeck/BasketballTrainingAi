export const DEFAULT_COACH_RESPONSE_MODEL = "gpt-5.6-luna";
export const COMPLEX_COACH_RESPONSE_MODEL = "gpt-5.6-terra";

export interface CoachTurnRequest {
  dayId: string;
  sessionKey: string;
  turnId: string;
  transcript: string;
  stateVersion: number;
  conversationSummary?: string;
}

export type CoachTurnValidation =
  | { ok: true; value: CoachTurnRequest }
  | { ok: false; error: string };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function validateCoachTurnRequest(input: unknown): CoachTurnValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const body = input as Record<string, unknown>;
  const dayId = typeof body.day_id === "string" ? body.day_id : "";
  const sessionKey = typeof body.session_key === "string" ? body.session_key : "";
  const turnId = typeof body.turn_id === "string" ? body.turn_id : "";
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const stateVersion = Number(body.state_version);
  const conversationSummary =
    typeof body.conversation_summary === "string"
      ? body.conversation_summary.trim()
      : undefined;
  if (!dayId || dayId.length > 64) return { ok: false, error: "Invalid day_id." };
  if (sessionKey.length < 16 || sessionKey.length > 128) {
    return { ok: false, error: "Invalid session_key." };
  }
  if (turnId.length < 8 || turnId.length > 128 || !SAFE_ID.test(turnId)) {
    return { ok: false, error: "Invalid turn_id." };
  }
  if (!transcript || transcript.length > 2_000) {
    return { ok: false, error: "Transcript must be between 1 and 2000 characters." };
  }
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
    return { ok: false, error: "Invalid state_version." };
  }
  if ((conversationSummary?.length ?? 0) > 2_000) {
    return { ok: false, error: "Conversation summary is too large." };
  }
  return {
    ok: true,
    value: {
      dayId,
      sessionKey,
      turnId,
      transcript,
      stateVersion,
      conversationSummary,
    },
  };
}

/**
 * Terra is reserved for requests that can require several dependent workout
 * changes or performance analysis. A single add/remove/change remains on Luna.
 */
export function selectCoachResponseModel(transcript: string): {
  model: string;
  reasoningEffort: "none" | "low";
} {
  const text = transcript.toLowerCase();
  const analysis =
    /\b(?:analy[sz]e|compare|why am i|weakness(?:es)?|improve my|performance trend|breakdown)\b/.test(
      text
    );
  const broadMutation =
    /\b(?:rebuild|redesign|rework|replace|change|make|edit)\b/.test(text) &&
    /\b(?:entire|whole|all|workout|plan|multiple|several)\b/.test(text);
  const multiStep =
    /\b(?:then|and then|after that|as well as)\b/.test(text) &&
    /\b(?:add|remove|change|move|shorten|extend)\b/.test(text);
  return analysis || broadMutation || multiStep
    ? { model: COMPLEX_COACH_RESPONSE_MODEL, reasoningEffort: "low" }
    : { model: DEFAULT_COACH_RESPONSE_MODEL, reasoningEffort: "none" };
}

export interface ResponsesFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface ResponsesStreamHandlers {
  onTextDelta(delta: string): void | Promise<void>;
  onFunctionCall(call: ResponsesFunctionCall): void | Promise<void>;
  onCompleted(responseId: string | null, usage: Record<string, unknown> | null): void | Promise<void>;
}

/** Parse OpenAI's SSE response without assuming network chunk boundaries. */
export async function consumeResponsesSse(
  stream: ReadableStream<Uint8Array>,
  handlers: ResponsesStreamHandlers
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const processEvent = async (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, any>;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      await handlers.onTextDelta(event.delta);
      return;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      await handlers.onFunctionCall({
        callId: String(event.item.call_id ?? event.item.id ?? ""),
        name: String(event.item.name ?? ""),
        argumentsJson: String(event.item.arguments ?? "{}"),
      });
      return;
    }
    if (event.type === "response.completed") {
      await handlers.onCompleted(
        typeof event.response?.id === "string" ? event.response.id : null,
        event.response?.usage && typeof event.response.usage === "object"
          ? event.response.usage
          : null
      );
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) await processEvent(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) await processEvent(buffer);
}

