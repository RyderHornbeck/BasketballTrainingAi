import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildCoachTurnDynamicContext,
  buildCompactContextSummary,
  COACH_TURN_STABLE_SYSTEM_PROMPT,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import {
  buildAnthropicSystemBlocks,
  consumeAnthropicSse,
  createAbortTimeout,
  inferCoachResponseCapabilities,
  isConfidentlyToolFreeCoachRequest,
  type ResponsesFunctionCall,
  resolveCoachToolContinuation,
  selectCoachResponseModel,
  shouldForceCoachTool,
  validateCoachTurnRequest,
} from "../_shared/coachResponse.ts";
import {
  generatedResponseTools,
  validateCoachToolArguments,
} from "../_shared/generated/coachTools.ts";
import { estimateAnthropicCostUsd } from "../_shared/coachUsage.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 4;
const ANTHROPIC_TIMEOUT_MS = 15_000;

function defer(promise: Promise<unknown>) {
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(promise);
  else void promise.catch((error) => console.error("deferred coach task failed:", error));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }
  if (!(await hasCurrentAIDataConsent(supabase, userData.user.id))) {
    return jsonResponse(aiDataConsentRequiredBody(), 403);
  }
  const parsed = validateCoachTurnRequest(await req.json().catch(() => null));
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
  const turn = parsed.value;
  const userId = userData.user.id;

  const { data: session } = await supabase
    .from("coach_sessions")
    .select("id, day_id, ended_at, expires_at, state_version")
    .eq("session_key", turn.sessionKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !session ||
    session.day_id !== turn.dayId ||
    session.ended_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return jsonResponse({ error: "Coach session is not active." }, 409);
  }
  if (turn.stateVersion < Number(session.state_version ?? 0)) {
    return jsonResponse(
      {
        error: "Workout state changed before this turn started.",
        code: "stale_state_version",
        state_version: Number(session.state_version ?? 0),
      },
      409,
    );
  }

  const { model } = selectCoachResponseModel(turn.transcript);
  const responseTools = generatedResponseTools(
    inferCoachResponseCapabilities(turn.transcript),
  );
  const anthropicTools = responseTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    eager_input_streaming: true,
  }));
  const speculativeReadOnly = turn.mode === "speculative_read_only";
  const claimPromise = speculativeReadOnly
    ? Promise.resolve({ data: null, error: null })
    : supabase.rpc("claim_coach_agent_turn", {
      p_user_id: userId,
      p_session_id: session.id,
      p_day_id: turn.dayId,
      p_turn_key: turn.turnId,
      p_state_version: turn.stateVersion,
      p_transcript: turn.transcript,
      p_model: model,
    });
  const [claimResult, initialContext, answersResult, profileResult] =
    await Promise.all([
      claimPromise,
      loadWorkoutContext(supabase, userId, turn.dayId),
      supabase
        .from("onboarding_answers")
        .select("main_goal")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("realtime_coach_voice")
        .eq("id", userId)
        .maybeSingle(),
    ]);
  const { data: claimedTurnId, error: claimError } = claimResult;
  if (claimError) {
    console.error("coach-turn claim failed:", claimError);
    return jsonResponse({ error: "Could not claim coach turn." }, 500);
  }
  if (!speculativeReadOnly && !claimedTurnId) {
    return jsonResponse({ error: "Coach turn already exists." }, 409);
  }
  const claimedTurn = claimedTurnId ? { id: String(claimedTurnId) } : null;

  if (!initialContext) {
    return jsonResponse({ error: "Workout day not found" }, 404);
  }
  const answers = answersResult.data;
  const profile = profileResult.data;
  const coachName = profile?.realtime_coach_voice === "cedar"
    ? "Coach Devin"
    : profile?.realtime_coach_voice === "marin"
    ? "Coach Maya"
    : profile?.realtime_coach_voice === "shimmer"
    ? "Coach Ava"
    : "Coach Tyler";
  const compactContext = buildCompactContextSummary(
    initialContext,
    answers ?? null,
    undefined,
    turn.conversationSummary,
  );
  const initialFingerprint = await sha256(compactContext);
  const confidentlyToolFree = isConfidentlyToolFreeCoachRequest(
    turn.transcript,
    turn.conversationSummary,
  );
  const toolFreeTurn = speculativeReadOnly || confidentlyToolFree;
  const dynamicContext = buildCoachTurnDynamicContext(
    initialContext,
    answers ?? null,
    turn.conversationSummary,
    coachName,
    speculativeReadOnly,
    !confidentlyToolFree,
  );

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let closed = false;
  const send = async (payload: Record<string, unknown>) => {
    if (closed || req.signal.aborted) return;
    await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
  };

  const run = async () => {
    let previousResponseId: string | null = null;
    const messages: Array<Record<string, unknown>> = [
      { role: "user", content: turn.transcript },
    ];
    let nextStateVersion = turn.stateVersion;
    let totalToolCalls = 0;
    let outputCharacters = 0;
    let emittedSpeech = false;
    let mutationApplied = false;
    const usageEvents: Array<Record<string, unknown>> = [];
    try {
      await send({
        type: "turn_started",
        turn_id: turn.turnId,
        model,
        state_version: nextStateVersion,
        state_fingerprint: initialFingerprint,
      });
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const toolsEnabled = !toolFreeTurn && round < MAX_TOOL_ROUNDS;
        const forceTool = round === 0 &&
          shouldForceCoachTool(turn.transcript, turn.conversationSummary);
        const streamImmediately = toolFreeTurn || !toolsEnabled;
        if (!(await hasCurrentAIDataConsent(supabase, userId))) {
          throw new Error(
            "AI data processing permission was withdrawn during this turn.",
          );
        }
        const providerDeadline = createAbortTimeout(
          req.signal,
          ANTHROPIC_TIMEOUT_MS,
        );
        const calls: ResponsesFunctionCall[] = [];
        let roundText = "";
        let completedResponseId: string | null = null;
        let roundStopReason: string | null = null;
        try {
          const anthropicResponse = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              signal: providerDeadline.signal,
              headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "prompt-caching-2024-07-31",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                system: buildAnthropicSystemBlocks(
                  COACH_TURN_STABLE_SYSTEM_PROMPT,
                  dynamicContext,
                ),
                messages,
                ...(toolsEnabled
                  ? {
                    tools: anthropicTools,
                    tool_choice: {
                      type: forceTool ? "any" : "auto",
                      disable_parallel_tool_use: true,
                    },
                  }
                  : {}),
                stream: true,
                max_tokens: 300,
                service_tier: "auto",
              }),
            },
          );
          if (!anthropicResponse.ok || !anthropicResponse.body) {
            const detail = await anthropicResponse.text();
            throw new Error(
              `Anthropic Messages API failed (${anthropicResponse.status}): ${
                detail.slice(0, 300)
              }`,
            );
          }
          await consumeAnthropicSse(anthropicResponse.body, {
            onTextDelta: (delta) => {
              roundText += delta;
              if (streamImmediately) {
                outputCharacters += delta.length;
                if (delta.trim()) emittedSpeech = true;
                return send({
                  type: "text_delta",
                  turn_id: turn.turnId,
                  state_version: nextStateVersion,
                  delta,
                });
              }
            },
            onFunctionCall: (call) => {
              calls.push(call);
            },
            onCompleted: (responseId, usage) => {
              completedResponseId = responseId;
              roundStopReason = typeof usage?.stop_reason === "string"
                ? usage.stop_reason
                : null;
              if (usage) usageEvents.push(usage);
            },
          });
        } catch (error) {
          if (providerDeadline.didTimeout()) {
            console.error("Anthropic provider timeout:", error);
            throw new Error("Anthropic provider request timed out.");
          }
          throw error;
        } finally {
          providerDeadline.dispose();
        }
        previousResponseId = completedResponseId ?? previousResponseId;
        if (roundStopReason === "max_tokens") {
          throw new Error("Coach response reached its output limit.");
        }
        if (calls.length === 0) {
          if (!streamImmediately && roundText.trim()) {
            outputCharacters += roundText.length;
            emittedSpeech = true;
            await send({
              type: "text_delta",
              turn_id: turn.turnId,
              state_version: nextStateVersion,
              delta: roundText,
            });
          }
          break;
        }
        if (!toolsEnabled) {
          throw new Error("Coach emitted a tool call during final synthesis.");
        }
        totalToolCalls += calls.length;
        if (totalToolCalls > MAX_TOOL_CALLS) {
          throw new Error("Coach tool-call limit exceeded.");
        }

        const outputs: Array<Record<string, unknown>> = [];
        const assistantToolUses: Array<Record<string, unknown>> = [];
        const exactSpeech = new Set<string>();
        let continueWithModel = false;
        let modelResponseSkipped = false;
        for (const call of calls) {
          let toolArgs: unknown;
          try {
            toolArgs = JSON.parse(call.argumentsJson);
          } catch {
            throw new Error(`Invalid JSON arguments for ${call.name}.`);
          }
          const validated = validateCoachToolArguments(call.name, toolArgs);
          if (!validated.ok) throw new Error(validated.error);
          assistantToolUses.push({
            type: "tool_use",
            id: call.callId,
            name: call.name,
            input: validated.value,
          });
          const clientRequestId = `${turn.turnId}:${
            call.callId || crypto.randomUUID()
          }`.slice(0, 200);
          const toolResponse = await fetch(
            `${SUPABASE_URL}/functions/v1/coach-tools`,
            {
              method: "POST",
              signal: req.signal,
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                day_id: turn.dayId,
                session_key: turn.sessionKey,
                tool_name: call.name,
                arguments: {
                  ...validated.value,
                  client_request_id: clientRequestId,
                },
                refresh_context: true,
              }),
            },
          );
          const toolResult = await toolResponse.json().catch(() => ({}));
          if (!toolResponse.ok) {
            throw new Error(
              typeof toolResult?.error === "string"
                ? toolResult.error
                : "Coach tool failed.",
            );
          }
          mutationApplied = mutationApplied ||
            Boolean(toolResult.db_changed || toolResult.client_action);
          const continuation = resolveCoachToolContinuation(toolResult);
          if (continuation.type === "none") {
            modelResponseSkipped = true;
          } else if (continuation.type === "speak_exact") {
            exactSpeech.add(continuation.speech);
          } else {
            // Unknown or absent continuation values retain the safer model path.
            continueWithModel = true;
          }
          if (typeof toolResult.state_version === "number") {
            nextStateVersion = Math.max(
              nextStateVersion,
              toolResult.state_version,
            );
          } else if (toolResult.db_changed) {
            nextStateVersion += 1;
          }
          await send({
            type: "tool_result",
            turn_id: turn.turnId,
            call_id: call.callId,
            name: call.name,
            state_version: nextStateVersion,
            db_changed: Boolean(toolResult.db_changed),
            client_action: toolResult.client_action ?? null,
            workout_context: toolResult.client_workout_context ?? null,
          });
          outputs.push({
            type: "tool_result",
            tool_use_id: call.callId,
            content: JSON.stringify({
              result: toolResult.result,
              state_version: nextStateVersion,
              workout: toolResult.updated_context ?? null,
            }),
          });
        }
        if (!continueWithModel) {
          if (exactSpeech.size) {
            const speech = [...exactSpeech].join(" ");
            outputCharacters += speech.length;
            emittedSpeech = true;
            await send({
              type: "text_delta",
              turn_id: turn.turnId,
              state_version: nextStateVersion,
              delta: speech,
            });
          } else if (modelResponseSkipped) {
            // The tool/client owns any local confirmation for continuation=none.
            emittedSpeech = true;
          }
          break;
        }
        const assistantContent: Array<Record<string, unknown>> = [
          ...(roundText.trim() ? [{ type: "text", text: roundText }] : []),
          ...assistantToolUses,
        ];
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({ role: "user", content: outputs });
      }

      if (!emittedSpeech) {
        const fallback = mutationApplied
          ? "The change went through, but I couldn't finish the response."
          : "I couldn't finish that. Try asking again.";
        outputCharacters += fallback.length;
        emittedSpeech = true;
        await send({
          type: "text_delta",
          turn_id: turn.turnId,
          state_version: nextStateVersion,
          delta: fallback,
        });
      }

      const finalContext = speculativeReadOnly
        ? initialContext
        : await loadWorkoutContext(
          supabase,
          userId,
          turn.dayId,
        );
      const finalCompact = finalContext
        ? buildCompactContextSummary(
          finalContext,
          answers ?? null,
          undefined,
          turn.conversationSummary,
        )
        : compactContext;
      const finalFingerprint = await sha256(finalCompact);
      if (claimedTurn) {
        await supabase
          .from("coach_agent_turns")
          .update({
            status: "completed",
            state_version: nextStateVersion,
            state_fingerprint: finalFingerprint,
            response_id: previousResponseId,
            output_chars: outputCharacters,
            completed_at: new Date().toISOString(),
          })
          .eq("id", claimedTurn.id);
      }
      await send({
        type: "turn_completed",
        turn_id: turn.turnId,
        state_version: nextStateVersion,
        state_fingerprint: finalFingerprint,
        workout_context: finalCompact,
      });
      if (usageEvents.length && claimedTurn) {
        defer((async () => {
          for (const [index, usage] of usageEvents.entries()) {
            const inputTokens = Number(usage.input_tokens ?? 0);
            const outputTokens = Number(usage.output_tokens ?? 0);
            const cacheCreationInputTokens = Number(
              usage.cache_creation_input_tokens ?? 0,
            );
            const cacheReadInputTokens = Number(
              usage.cache_read_input_tokens ?? 0,
            );
            await supabase.rpc("record_coach_provider_metric", {
              p_user_id: userId,
              p_session_id: session.id,
              p_day_id: turn.dayId,
              p_turn_id: claimedTurn.id,
              p_provider: "anthropic",
              p_provider_request_id: `${turn.turnId}:messages:${index}`,
              p_metric: "messages_tokens",
              p_quantity: Math.max(
                0,
                inputTokens +
                  outputTokens +
                  cacheCreationInputTokens +
                  cacheReadInputTokens,
              ),
              p_unit: "tokens",
              p_estimated_cost_usd: estimateAnthropicCostUsd({
                model,
                inputTokens,
                outputTokens,
                cacheCreationInputTokens,
                cacheReadInputTokens,
              }),
              p_metadata: {
                ...usage,
                prompt_cache_ttl: "1h",
                stable_prefix_cache_eligible:
                  COACH_TURN_STABLE_SYSTEM_PROMPT.length >= 16_384,
              },
            });
          }
        })());
      }
    } catch (error) {
      const aborted = req.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      const providerTimedOut = error instanceof Error &&
        error.message === "Anthropic provider request timed out.";
      if (claimedTurn) {
        await supabase
          .from("coach_agent_turns")
          .update({
            status: aborted ? "cancelled" : "failed",
            error_code: aborted
              ? "client_cancelled"
              : providerTimedOut
              ? "provider_timeout"
              : "turn_failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", claimedTurn.id);
      }
      if (!aborted) {
        console.error("coach-turn error:", error);
        await send({
          type: "error",
          turn_id: turn.turnId,
          error: "Coach response failed.",
        });
      }
    } finally {
      closed = true;
      await writer.close().catch(() => undefined);
    }
  };
  void run();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
