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
    const speech = assessCoachSpeech(response.say);
    if (speech.ok) return { type: "speak_exact", speech: speech.text };
  }
  return { type: "model" };
}

/** Athlete-facing progress audio before slow tools; never expose tool syntax. */
export function coachToolPreamble(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  if (toolName === "search_exercise_catalog") {
    const raw = typeof args.query === "string" ? args.query : "";
    const subject = raw
      .replace(
        /\b(?:search|find|look|show|query|catalog|exercise|drill)s?\b/gi,
        " ",
      )
      .replace(/\b(?:for|me|please|the|a|an|called|named)\b/gi, " ")
      .replace(/[^a-z0-9' -]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const safeSubject =
      subject && subject.split(" ").length <= 7 && subject.length <= 60
        ? subject
        : "that drill";
    const speech = assessCoachSpeech(`I'm searching for ${safeSubject}.`);
    return speech.ok ? speech.text : "I'm searching for that drill.";
  }

  const preambles: Record<string, string> = {
    set_current_drill: "I'm moving you there.",
    skip_drill: "I'm moving you to the next drill.",
    set_set_completion: "I'm making that change.",
    complete_drill: "I'm marking that drill complete.",
    uncomplete_drill: "I'm reopening that drill.",
    finish_workout: "I'm finishing your workout.",
    start_timer: "I'm starting the timer.",
    pause_timer: "I'm pausing the timer.",
    resume_timer: "I'm resuming the timer.",
    stop_timer: "I'm stopping the timer.",
    set_timed_set_duration: "I'm changing that set time.",
    set_shooting_set_targets: "I'm changing those targets.",
    add_workout_exercise: "I'm adding that drill.",
    remove_workout_exercise: "I'm removing that drill.",
    save_note: "I'm saving that note.",
  };
  return preambles[toolName] ?? null;
}

/** Return a safe exact confirmation for an already-applied tool action. */
export function successfulCoachToolConfirmation(
  result: unknown,
): string | null {
  if (!result || typeof result !== "object") return null;
  const toolResult = result as Record<string, unknown>;
  if (!toolResult.db_changed && !toolResult.client_action) return null;
  if (typeof toolResult.result !== "string") return null;
  const speech = assessCoachSpeech(toolResult.result);
  return speech.ok && !/^error\b/i.test(speech.text) ? speech.text : null;
}

/** Convert canonical/OpenAI-style tools to Anthropic's native tool contract. */
export function buildAnthropicTools(
  tools: ReadonlyArray<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

export function buildAnthropicSystemBlocks(
  stablePolicy: string,
  dynamicContext: string,
): Array<Record<string, unknown>> {
  return [
    {
      type: "text",
      text: stablePolicy,
      // Tools precede system in Anthropic's prompt prefix. This explicit
      // breakpoint caches the complete stable tools → policy prefix.
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: dynamicContext },
  ];
}

/**
 * Reconstruct the persisted, ordered coach dialogue as Anthropic messages and
 * append the newest user input. The newest input remains the only new message
 * on the next request, allowing top-level automatic prompt caching to advance
 * over the prior dialogue.
 */
export function buildAnthropicConversationMessages(
  history: string | null | undefined,
  newestUserInput: string,
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const turns = String(history ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(User|Coach)\s*:\s*(.*)$/i);
      return match
        ? {
          role: match[1].toLowerCase() === "user" ? "user" : "assistant",
          content: match[2].trim(),
        }
        : null;
    })
    .filter((turn): turn is { role: "user" | "assistant"; content: string } =>
      Boolean(turn?.content)
    );

  for (const turn of turns) {
    const previous = messages.at(-1);
    if (previous?.role === turn.role && typeof previous.content === "string") {
      previous.content = `${previous.content}\n${turn.content}`;
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  const newest = newestUserInput.trim();
  if (newest) {
    const previous = messages.at(-1);
    if (previous?.role === "user" && typeof previous.content === "string") {
      previous.content = `${previous.content}\n${newest}`;
    } else {
      messages.push({ role: "user", content: newest });
    }
  }
  return messages;
}

/** Combine client cancellation with a provider deadline without leaking timers. */
export function createAbortTimeout(
  parentSignal: AbortSignal,
  timeoutMs: number,
): AbortTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () =>
    controller.abort(
      parentSignal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Provider request timed out", "TimeoutError"),
    );
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

export type CoachSpeechAssessment =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "internal_syntax" | "reasoning" };

/**
 * Reject provider text that is not safe to hand directly to speech synthesis.
 * This is intentionally structural rather than tool-name based so newly added
 * tools receive the same protection.
 */
export function assessCoachSpeech(text: string): CoachSpeechAssessment {
  const candidate = text.trim();
  if (!candidate) return { ok: false, reason: "empty" };
  if (
    /```|<\/?[a-z][^>]*>|\{[\s\S]*["'][^"']+["']\s*:|(?:^|\s)(?:function[\s_-]*calls?|tool[\s_-]*(?:call|use)|input[\s_-]*json|function[\s_-]*result)(?:\s|$)|\b(?:invoke|recipient)\b|\b(?:arguments?|parameters?)\s*(?:=|:)|(?:^|\s)(?:function_call|tool_use|input_json_delta)(?:\s|$)/i
      .test(candidate)
  ) {
    return { ok: false, reason: "internal_syntax" };
  }
  if (
    /<\/?(?:analysis|thinking|reasoning)\b|(?:^|\n)\s*(?:analysis|reasoning|thought process)\s*:|\b(?:the user (?:asks|wants)|i (?:need|should|will) (?:to )?(?:call|invoke|use) (?:a |the )?(?:tool|function))\b/i
      .test(candidate)
  ) {
    return { ok: false, reason: "reasoning" };
  }
  return { ok: true, text: candidate };
}

/** Prevent a previously rejected model utterance from contaminating later turns. */
export function sanitizeCoachConversationSummary(
  summary: string | null | undefined,
): string | undefined {
  if (!summary) return undefined;
  const clean = summary
    .split(/\r?\n/)
    .filter((line) => {
      const coachText = line.replace(/^\s*(?:assistant|coach)\s*:\s*/i, "");
      return assessCoachSpeech(coachText).ok;
    })
    .join("\n")
    .trim();
  return clean || undefined;
}

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
  const blockTypes = new Map<number, string>();
  let buffer = "";
  let messageId: string | null = null;
  let usage: Record<string, unknown> = {};
  let messageStarted = false;
  let messageStopped = false;

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
      if (messageStarted) {
        throw new Error("Anthropic stream contained duplicate message_start.");
      }
      messageStarted = true;
      messageId = typeof event.message?.id === "string"
        ? event.message.id
        : null;
      if (event.message?.usage && typeof event.message.usage === "object") {
        usage = { ...usage, ...event.message.usage };
      }
      return;
    }
    if (event.type === "content_block_start") {
      const index = Number(event.index);
      const blockType = typeof event.content_block?.type === "string"
        ? event.content_block.type
        : "";
      if (!Number.isSafeInteger(index) || !blockType || blockTypes.has(index)) {
        throw new Error("Anthropic stream contained an invalid content block.");
      }
      blockTypes.set(index, blockType);
      if (blockType === "tool_use") {
        const callId = typeof event.content_block?.id === "string"
          ? event.content_block.id
          : "";
        const name = typeof event.content_block?.name === "string"
          ? event.content_block.name
          : "";
        if (!callId || !name) {
          throw new Error("Anthropic tool block omitted its ID or name.");
        }
        toolBlocks.set(index, {
          callId,
          name,
          initialInput: event.content_block.input ?? {},
          partialJson: "",
        });
      }
      return;
    }
    if (event.type === "content_block_delta") {
      const index = Number(event.index);
      const blockType = blockTypes.get(index);
      if (
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        if (blockType !== "text") {
          throw new Error(
            "Anthropic text delta did not belong to a text block.",
          );
        }
        await handlers.onTextDelta(event.delta.text);
      } else if (
        event.delta?.type === "input_json_delta" &&
        typeof event.delta.partial_json === "string"
      ) {
        const tool = toolBlocks.get(index);
        if (!tool || blockType !== "tool_use") {
          throw new Error("Anthropic tool JSON delta had no open tool block.");
        }
        tool.partialJson += event.delta.partial_json;
      }
      return;
    }
    if (event.type === "content_block_stop") {
      const index = Number(event.index);
      const blockType = blockTypes.get(index);
      if (!blockType) {
        throw new Error("Anthropic stopped an unknown content block.");
      }
      blockTypes.delete(index);
      const tool = toolBlocks.get(index);
      if (blockType === "tool_use") {
        if (!tool) {
          throw new Error("Anthropic tool block was not initialized.");
        }
        toolBlocks.delete(index);
        await handlers.onFunctionCall({
          callId: tool.callId,
          name: tool.name,
          argumentsJson: tool.partialJson || JSON.stringify(tool.initialInput),
        });
      }
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
      if (
        !messageStarted || messageStopped || blockTypes.size || toolBlocks.size
      ) {
        throw new Error(
          "Anthropic stream ended with incomplete content blocks.",
        );
      }
      messageStopped = true;
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
  if (
    !messageStarted || !messageStopped || blockTypes.size || toolBlocks.size
  ) {
    throw new Error("Anthropic stream ended before message_stop.");
  }
}
