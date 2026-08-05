export const DEFAULT_COACH_RESPONSE_MODEL = "claude-haiku-4-5-20251001";

export const COACH_RESPONSE_CAPABILITY_ORDER = [
  "reads",
  "shots",
  "navigation",
  "timers",
  "completion",
  "edits",
  "recommendations",
  "notes",
] as const;

export type CoachResponseCapability =
  (typeof COACH_RESPONSE_CAPABILITY_ORDER)[number];

export interface CoachTurnRequest {
  dayId: string;
  sessionKey: string;
  turnId: string;
  transcript: string;
  stateVersion: number;
  conversationSummary?: string;
  mode: "standard" | "speculative_read_only";
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
  const sessionKey = typeof body.session_key === "string"
    ? body.session_key
    : "";
  const turnId = typeof body.turn_id === "string" ? body.turn_id : "";
  const transcript = typeof body.transcript === "string"
    ? body.transcript.trim()
    : "";
  const stateVersion = Number(body.state_version);
  const conversationSummary = typeof body.conversation_summary === "string"
    ? body.conversation_summary.trim()
    : undefined;
  const mode = body.mode === undefined || body.mode === "standard"
    ? "standard"
    : body.mode === "speculative_read_only"
    ? "speculative_read_only"
    : null;
  if (!dayId || dayId.length > 64) {
    return { ok: false, error: "Invalid day_id." };
  }
  if (sessionKey.length < 16 || sessionKey.length > 128) {
    return { ok: false, error: "Invalid session_key." };
  }
  if (turnId.length < 8 || turnId.length > 128 || !SAFE_ID.test(turnId)) {
    return { ok: false, error: "Invalid turn_id." };
  }
  if (!transcript || transcript.length > 2_000) {
    return {
      ok: false,
      error: "Transcript must be between 1 and 2000 characters.",
    };
  }
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
    return { ok: false, error: "Invalid state_version." };
  }
  if ((conversationSummary?.length ?? 0) > 2_000) {
    return { ok: false, error: "Conversation summary is too large." };
  }
  if (!mode) {
    return { ok: false, error: "Invalid coach turn mode." };
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
      mode,
    },
  };
}

/** Keep every fallback turn on the lowest-latency model and reasoning setting. */
export function selectCoachResponseModel(_transcript: string): {
  model: typeof DEFAULT_COACH_RESPONSE_MODEL;
  reasoningEffort: "none";
} {
  return { model: DEFAULT_COACH_RESPONSE_MODEL, reasoningEffort: "none" };
}

/**
 * Limit the tool payload to likely capabilities. Ambiguous conversational
 * requests retain the complete catalog so this optimization never removes an
 * ability from the coach.
 */
export function inferCoachResponseCapabilities(
  transcript: string,
): CoachResponseCapability[] {
  const text = transcript.toLowerCase();
  const capabilities = new Set<CoachResponseCapability>(["reads"]);
  if (
    /\b(?:make|made|miss|missed|brick|airball|swish|shot|shooting|attempt|target|percentage)\b/
      .test(text)
  ) {
    capabilities.add("shots");
  }
  if (
    /\b(?:timer|second|minute|pause|resume|countdown|duration)\b/.test(text)
  ) {
    capabilities.add("timers");
  }
  if (
    /\b(?:next|previous|first|last|where|move|switch|skip|drill|exercise|set)\b/
      .test(text)
  ) {
    capabilities.add("navigation");
  }
  if (
    /\b(?:complete|completed|finished|done|reopen|uncomplete|finish workout)\b/
      .test(text)
  ) {
    capabilities.add("completion");
  }
  if (
    /\b(?:add|remove|change|edit|replace|extend|shorten|longer|shorter|rebuild)\b/
      .test(text)
  ) {
    capabilities.add("edits");
    capabilities.add("recommendations");
  }
  if (/\b(?:recommend|suggest|weakness|work on|catalog|find)\b/.test(text)) {
    capabilities.add("recommendations");
  }
  if (/\b(?:note|remember)\b/.test(text)) capabilities.add("notes");
  if (
    capabilities.size === 1 &&
    !/\b(?:progress|workout|how|what|where|list|status)\b/.test(text)
  ) {
    return [...COACH_RESPONSE_CAPABILITY_ORDER];
  }
  return COACH_RESPONSE_CAPABILITY_ORDER.filter((capability) =>
    capabilities.has(capability)
  );
}

export function isCoachMutationRequest(
  transcript: string,
  conversationSummary?: string,
): boolean {
  const text = transcript.trim().toLowerCase();
  if (
    /\b(?:add|remove|delete|change|edit|replace|move|switch|skip|complete|finish|reopen|uncomplete|start|pause|resume|stop|reset|extend|shorten|save|record|undo)\b/
      .test(text)
  ) {
    return true;
  }
  const isAffirmative = /^(?:yes|yeah|yep|sure|do it|please do|go ahead)\b/
    .test(
      text,
    );
  const latestCoachTurn = (conversationSummary ?? "").split("Coach:").pop() ??
    "";
  return isAffirmative &&
    /\b(?:(?:do|would) you (?:want|like) me to|should i|want me to|would you like)\b/i
      .test(
        latestCoachTurn,
      );
}

/**
 * Only bypass tools when the utterance is clearly conversational and cannot
 * require authoritative workout state. False negatives cost latency; false
 * positives could produce an unsupported state claim, so this stays narrow.
 */
export function isConfidentlyToolFreeCoachRequest(
  transcript: string,
  conversationSummary?: string,
): boolean {
  if (isCoachMutationRequest(transcript, conversationSummary)) return false;
  const text = transcript.trim().toLowerCase();
  if (
    /\b(?:workout|drill|exercise|set|shot|make|miss|progress|target|timer|time|next|previous|current|first|last|done|complete|remaining|today|catalog|recommend|suggest|list|show|find|search|where|how many|what(?:'s| is) next)\b/
      .test(text)
  ) {
    return false;
  }
  return /^(?:(?:hey|hi|hello|thanks|thank you|bye|goodbye)[!. ]*|(?:what(?:'s| is) your name|who are you)[?.! ]*|(?:motivate me|encourage me|give me (?:some )?(?:motivation|encouragement)|tell me (?:a )?(?:joke|fun fact)|how (?:do|can) i (?:improve|shoot|(?:improve )?(?:my )?dribbl(?:e|ing)|finish|defend)|(?:give me|share) (?:a )?(?:shooting|dribbling|finishing|defense) tip)[?.! ]*)$/i
    .test(text);
}

export interface AbortTimeout {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
}

export type CoachToolContinuation =
  | { type: "model" }
  | { type: "speak_exact"; speech: string }
  | { type: "none" };

/** Normalize the coach-tools continuation contract with skip-model precedence. */
export function resolveCoachToolContinuation(
  response: Record<string, unknown>,
): CoachToolContinuation {
  if (
    response.skip_model_response === true || response.continuation === "none"
  ) {
    return { type: "none" };
  }
  if (
    response.continuation === "speak_exact" &&
    typeof response.say === "string" &&
    response.say.trim()
  ) {
    return { type: "speak_exact", speech: response.say.trim() };
  }
  return { type: "model" };
}

export function buildAnthropicSystemBlocks(
  stablePolicy: string,
  dynamicContext: string,
): Array<Record<string, unknown>> {
  // Haiku's 1-hour cache only pays off once this stable prefix naturally
  // reaches its minimum size. Never pad the low-latency voice policy.
  const cacheable = stablePolicy.length >= 16_384;
  return [
    {
      type: "text",
      text: stablePolicy,
      ...(cacheable ? { cache_control: { type: "ephemeral", ttl: "1h" } } : {}),
    },
    { type: "text", text: dynamicContext },
  ];
}

/** Combine client cancellation with a provider deadline without leaking timers. */
export function createAbortTimeout(
  parentSignal: AbortSignal,
  timeoutMs: number,
): AbortTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () =>
    controller.abort(parentSignal.reason ?? new DOMException("Aborted", "AbortError"));
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Provider request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

/** Force clear tool turns through their first tool before speech is emitted. */
export function shouldForceCoachTool(
  transcript: string,
  conversationSummary?: string,
): boolean {
  if (isCoachMutationRequest(transcript, conversationSummary)) return true;
  return /\b(?:search|find|show|list|recommend|suggest|what drills|which drills)\b/i
    .test(transcript);
}

export interface ResponsesFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface ResponsesStreamHandlers {
  onTextDelta(delta: string): void | Promise<void>;
  onFunctionCall(call: ResponsesFunctionCall): void | Promise<void>;
  onCompleted(
    responseId: string | null,
    usage: Record<string, unknown> | null,
  ): void | Promise<void>;
}

export interface AnthropicStreamHandlers extends ResponsesStreamHandlers {}

/** Parse OpenAI's SSE response without assuming network chunk boundaries. */
export async function consumeResponsesSse(
  stream: ReadableStream<Uint8Array>,
  handlers: ResponsesStreamHandlers,
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
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      await handlers.onTextDelta(event.delta);
      return;
    }
    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "function_call"
    ) {
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
          : null,
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

/** Parse Anthropic Messages SSE, including incrementally streamed tool JSON. */
export async function consumeAnthropicSse(
  stream: ReadableStream<Uint8Array>,
  handlers: AnthropicStreamHandlers,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const toolBlocks = new Map<
    number,
    { callId: string; name: string; initialInput: unknown; partialJson: string }
  >();
  let buffer = "";
  let messageId: string | null = null;
  let usage: Record<string, unknown> = {};

  const processEvent = async (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as Record<string, any>;
    if (event.type === "error") {
      throw new Error(
        typeof event.error?.message === "string"
          ? event.error.message
          : "Anthropic streaming request failed.",
      );
    }
    if (event.type === "message_start") {
      messageId = typeof event.message?.id === "string"
        ? event.message.id
        : null;
      if (event.message?.usage && typeof event.message.usage === "object") {
        usage = { ...usage, ...event.message.usage };
      }
      return;
    }
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "tool_use"
    ) {
      toolBlocks.set(Number(event.index), {
        callId: String(event.content_block.id ?? ""),
        name: String(event.content_block.name ?? ""),
        initialInput: event.content_block.input ?? {},
        partialJson: "",
      });
      return;
    }
    if (event.type === "content_block_delta") {
      if (
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        await handlers.onTextDelta(event.delta.text);
      } else if (
        event.delta?.type === "input_json_delta" &&
        typeof event.delta.partial_json === "string"
      ) {
        const tool = toolBlocks.get(Number(event.index));
        if (tool) tool.partialJson += event.delta.partial_json;
      }
      return;
    }
    if (event.type === "content_block_stop") {
      const tool = toolBlocks.get(Number(event.index));
      if (!tool) return;
      toolBlocks.delete(Number(event.index));
      await handlers.onFunctionCall({
        callId: tool.callId,
        name: tool.name,
        argumentsJson: tool.partialJson || JSON.stringify(tool.initialInput),
      });
      return;
    }
    if (event.type === "message_delta") {
      if (event.usage && typeof event.usage === "object") {
        usage = { ...usage, ...event.usage };
      }
      if (typeof event.delta?.stop_reason === "string") {
        usage = { ...usage, stop_reason: event.delta.stop_reason };
      }
      return;
    }
    if (event.type === "message_stop") {
      await handlers.onCompleted(messageId, usage);
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
