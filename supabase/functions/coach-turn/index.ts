import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildWorkoutNavigation,
  buildCoachTurnDynamicContext,
  buildCurrentDrillExplanationContext,
  buildCompactContextSummary,
  COACH_TURN_STABLE_SYSTEM_PROMPT,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import {
  assessCoachSpeech,
  buildAnthropicConversationMessages,
  buildAnthropicSystemBlocks,
  buildAnthropicTools,
  coachToolFailureSpeech,
  coachToolPreamble,
  consumeAnthropicSse,
  createAbortTimeout,
  isConfidentlyToolFreeCoachRequest,
  isCurrentShootingCorrectionRequest,
  resolveCoachToolContinuation,
  type ResponsesFunctionCall,
  sanitizeCoachConversationSummary,
  selectCoachResponseModel,
  successfulCoachToolConfirmation,
  usesOptimisticToolPreamble,
  shouldForceCoachTool,
  validateCoachTurnRequest,
} from "../_shared/coachResponse.ts";
import {
  generatedResponseTools,
  validateCoachToolArguments,
} from "../_shared/generated/coachTools.ts";
import { COACH_LIMITS, estimateAnthropicCostUsd } from "../_shared/coachUsage.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 4;
const MAX_PROVIDER_FORMAT_RETRIES = 1;
const ANTHROPIC_TIMEOUT_MS = 15_000;

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

function guardTimerControl(
  toolName: string,
  timer: { running: boolean; elapsed_seconds: number; duration_seconds?: number | null } | undefined,
) {
  const pausesTimer = toolName === "pause_timer" || toolName === "stop_timer";
  if ((!pausesTimer && toolName !== "resume_timer") || !timer) {
    return null;
  }
  const hasTimer = timer.running || timer.elapsed_seconds > 0 ||
    timer.duration_seconds != null;
  const result = !hasTimer
    ? pausesTimer
      ? "You can't pause the timer because no timer is running."
      : "You can't resume the timer because no timer is running."
    : pausesTimer && !timer.running
    ? "The timer is already paused."
    : toolName === "resume_timer" && timer.running
    ? "The timer is already running."
    : null;
  return result == null
    ? null
    : {
      result,
      db_changed: false,
      client_action: null,
      continuation: "speak_exact",
      say: result,
    };
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
  // A read-only refresh from an older client build could advance its local
  // counter without advancing this session. Rebase that harmlessly stale
  // request to the server version instead of rejecting the entire spoken turn.
  turn.stateVersion = Math.max(
    turn.stateVersion,
    Number(session.state_version ?? 0),
  );

  const { model } = selectCoachResponseModel(turn.transcript);
  const speculativeReadOnly = turn.mode === "speculative_read_only";
  const safeConversationSummary = sanitizeCoachConversationSummary(
    turn.conversationSummary,
  );
  // Final turns must always retain the complete tool contract. Keyword-based
  // narrowing made natural requests such as "I want to do low pound dribbles"
  // unable to search the catalog and add the selected drill.
  const responseTools = speculativeReadOnly ? [] : generatedResponseTools();
  const anthropicTools = buildAnthropicTools(responseTools);
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
        .select("realtime_coach_voice, preferred_name")
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
    { ...(answers ?? {}), preferred_name: profile?.preferred_name ?? null },
    undefined,
    safeConversationSummary,
  );
  const initialFingerprint = await sha256(compactContext);
  const confidentlyToolFree = isConfidentlyToolFreeCoachRequest(
    turn.transcript,
    safeConversationSummary,
  );
  // How-to questions are answered directly, while action/state requests
  // retain tools. Speculative requests are always tool-free as well.
  const toolFreeTurn = speculativeReadOnly || confidentlyToolFree;
  const localShotContext = turn.localShotSessionContext;
  const authoritativeCurrentSet = buildWorkoutNavigation(initialContext).current_set_state;
  const localShotContextMatchesCurrentSet =
    localShotContext != null &&
    authoritativeCurrentSet?.exercise_id === localShotContext.exerciseId &&
    authoritativeCurrentSet.set_number === localShotContext.setNumber;
  const currentDrillExplanationRequested =
    /\b(?:explain|describe|walk me through|show me how to do)\b[\s\S]*\b(?:current|this)\s+(?:drill|exercise)\b/i
      .test(turn.transcript);
  const dynamicContext = `${buildCoachTurnDynamicContext(
    initialContext,
    { ...(answers ?? {}), preferred_name: profile?.preferred_name ?? null },
    undefined,
    coachName,
    undefined,
    speculativeReadOnly,
    !confidentlyToolFree,
  )}${
    localShotContextMatchesCurrentSet
      ? `\n\nLIVE DEVICE SHOOTING STATE: The athlete device has newer local progress for the current set. This overrides persisted makes and attempts only for this turn. Current set: ${JSON.stringify(
        localShotContext,
      )}. Use these exact totals for any correction.`
      : ""
  }${
    currentDrillExplanationRequested
      ? `\n\n${buildCurrentDrillExplanationContext(initialContext)}`
      : ""
  }`;

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
    // Preserve prior user/assistant messages in order. New tool exchanges are
    // appended below; none of the existing prefix is rewritten.
    const messages = buildAnthropicConversationMessages(
      safeConversationSummary,
      turn.transcript,
    );
    let nextStateVersion = turn.stateVersion;
    let totalToolCalls = 0;
    let outputCharacters = 0;
    let emittedSpeech = false;
    let mutationApplied = false;
    let lastSuccessfulToolConfirmation: string | null = null;
    let lastSuccessfulToolName: string | null = null;
    let lastToolWorkoutContext: string | null = null;
    const announcedPreambles = new Set<string>();
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
        // Give the model one chance to clarify an ambiguous request. If it
        // answers an action request without a native tool block, retry with a
        // required tool rather than letting it merely claim the action.
        const requestNeedsTool = round === 0 &&
          shouldForceCoachTool(
            turn.transcript,
            safeConversationSummary,
          );
        const forceShootingTotalCorrection = round === 0 &&
          isCurrentShootingCorrectionRequest(turn.transcript);
        if (!(await hasCurrentAIDataConsent(supabase, userId))) {
          throw new Error(
            "AI data processing permission was withdrawn during this turn.",
          );
        }
        const providerDeadline = createAbortTimeout(
          req.signal,
          ANTHROPIC_TIMEOUT_MS,
        );
        let calls: ResponsesFunctionCall[] = [];
        let roundText = "";
        let completedResponseId: string | null = null;
        let roundStopReason: string | null = null;
        try {
          for (
            let formatAttempt = 0;
            formatAttempt <= MAX_PROVIDER_FORMAT_RETRIES;
            formatAttempt += 1
          ) {
            calls = [];
            roundText = "";
            completedResponseId = null;
            roundStopReason = null;
            try {
              const retryInstruction = formatAttempt === 0
                ? ""
                : "\nThe prior response had an invalid output format. Return only natural athlete-facing speech or a native tool_use block. Never write or imitate tool syntax in text.";
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
                      `${dynamicContext}${retryInstruction}`,
                    ),
                    messages,
                    ...(toolsEnabled
                      ? {
                        tools: anthropicTools,
                        tool_choice: {
                          type: forceShootingTotalCorrection
                            ? "tool"
                            : formatAttempt > 0 && requestNeedsTool
                            ? "any"
                            : "auto",
                          ...(forceShootingTotalCorrection
                            ? { name: "correct_current_shooting_total" }
                            : {}),
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
                },
                onFunctionCall: (call) => {
                  calls.push(call);
                },
                onCompleted: (responseId, usage) => {
                  completedResponseId = responseId;
                  roundStopReason = typeof usage?.stop_reason === "string"
                    ? usage.stop_reason
                    : null;
                  if (usage) {
                    usageEvents.push(usage);
                    console.info("Anthropic prompt cache usage", {
                      input_tokens: Number(usage.input_tokens ?? 0),
                      cache_creation_input_tokens: Number(
                        usage.cache_creation_input_tokens ?? 0,
                      ),
                      cache_read_input_tokens: Number(
                        usage.cache_read_input_tokens ?? 0,
                      ),
                    });
                  }
                },
              });
            } catch (error) {
              if (providerDeadline.didTimeout()) {
                console.error("Anthropic provider timeout:", error);
                throw new Error("Anthropic provider request timed out.");
              }
              throw error;
            }

            let formatError: string | null = null;
            if (calls.length) {
              if (roundStopReason !== "tool_use") {
                formatError = "native tool blocks had a non-tool stop reason";
              } else {
                for (const call of calls) {
                  try {
                    const input = JSON.parse(call.argumentsJson);
                    const validated = validateCoachToolArguments(
                      call.name,
                      input,
                    );
                    if (!call.callId || !validated.ok) {
                      formatError = "native tool call was malformed";
                      break;
                    }
                  } catch {
                    formatError = "native tool JSON was malformed";
                    break;
                  }
                }
              }
            } else if (roundStopReason === "tool_use") {
              formatError =
                "tool use was required but no native tool block arrived";
            } else {
              const speech = assessCoachSpeech(roundText);
              if (speech.ok) {
                roundText = speech.text;
                if (requestNeedsTool) {
                  formatError =
                    "an action request received text without a native tool block";
                }
              } else {
                formatError = `text was unsafe for speech (${speech.reason})`;
              }
            }
            if (!formatError) break;
            if (formatAttempt === MAX_PROVIDER_FORMAT_RETRIES) {
              throw new Error(
                `Anthropic response format rejected: ${formatError}.`,
              );
            }
          }
        } finally {
          providerDeadline.dispose();
        }
        previousResponseId = completedResponseId ?? previousResponseId;
        if (roundStopReason === "max_tokens") {
          throw new Error("Coach response reached its output limit.");
        }
        if (calls.length === 0) {
          if (roundText.trim()) {
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
          let toolResult = guardTimerControl(call.name, turn.timer);
          let optimisticPreambleSpoken = false;
          if (!toolResult) {
            const preamble = coachToolPreamble(call.name, validated.value);
            if (preamble && !announcedPreambles.has(preamble)) {
              announcedPreambles.add(preamble);
              optimisticPreambleSpoken = usesOptimisticToolPreamble(call.name);
              emittedSpeech = true;
              outputCharacters += preamble.length;
              await send({
                type: "text_delta",
                turn_id: turn.turnId,
                state_version: nextStateVersion,
                delta: `${preamble} `,
              });
            }
            const clientRequestId = `${turn.turnId}:${
              call.callId || crypto.randomUUID()
            }`.slice(0, 200);
            try {
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
              toolResult = await toolResponse.json().catch(() => ({}));
              if (!toolResponse.ok) {
                toolResult = {
                  result: coachToolFailureSpeech(call.name),
                  db_changed: false,
                  client_action: null,
                  continuation: "speak_exact",
                  say: coachToolFailureSpeech(call.name),
                };
              }
            } catch (error) {
              if (req.signal.aborted) throw error;
              toolResult = {
                result: coachToolFailureSpeech(call.name),
                db_changed: false,
                client_action: null,
                continuation: "speak_exact",
                say: coachToolFailureSpeech(call.name),
              };
            }
          }
          mutationApplied = mutationApplied ||
            Boolean(toolResult.db_changed || toolResult.client_action);
          const toolApplied = Boolean(
            toolResult.db_changed || toolResult.client_action,
          );
          if (toolApplied) {
            const confirmation = successfulCoachToolConfirmation(toolResult);
            if (confirmation && !optimisticPreambleSpoken) {
              lastSuccessfulToolConfirmation = confirmation;
              lastSuccessfulToolName = call.name;
            }
            console.info("coach-turn tool succeeded", {
              turn_id: turn.turnId,
              tool_name: call.name,
              db_changed: Boolean(toolResult.db_changed),
              has_client_action: Boolean(toolResult.client_action),
            });
          }
          const continuation = resolveCoachToolContinuation(toolResult);
          if (optimisticPreambleSpoken && toolApplied) {
            // The action is already being spoken while this request runs.
            // Suppress a redundant model/result confirmation after success.
            modelResponseSkipped = true;
          } else if (
            optimisticPreambleSpoken &&
            continuation.type === "model" &&
            typeof toolResult.result === "string"
          ) {
            // The mutation was rejected without a transport error (for
            // example, a timer requested for a shooting set). State its
            // authoritative reason directly instead of asking the model to
            // narrate a second, potentially stale response.
            const speech = assessCoachSpeech(toolResult.result);
            if (speech.ok) {
              exactSpeech.add(speech.text);
              modelResponseSkipped = true;
            } else {
              continueWithModel = true;
            }
          } else if (continuation.type === "none") {
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
            incomplete_completion_confirmation:
              toolResult.incomplete_completion_confirmation ?? null,
          });
          if (typeof toolResult.client_workout_context === "string") {
            lastToolWorkoutContext = toolResult.client_workout_context;
          }
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
        // Pre-tool model prose is hidden from the athlete and omitted from the
        // next round so internal query narration cannot leak into speech.
        const assistantContent: Array<Record<string, unknown>> =
          assistantToolUses;
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({ role: "user", content: outputs });
      }

      if (!emittedSpeech) {
        console.warn("Coach turn completed without a safe spoken response.", {
          turnId: turn.turnId,
          mutationApplied,
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
      let dailyUsage: {
        spent_usd: number;
        budget_usd: number;
        remaining_usd: number;
      } | null = null;
      if (usageEvents.length && claimedTurn) {
        for (const [index, usage] of usageEvents.entries()) {
          const inputTokens = Number(usage.input_tokens ?? 0);
          const outputTokens = Number(usage.output_tokens ?? 0);
          const cacheCreationInputTokens = Number(
            usage.cache_creation_input_tokens ?? 0,
          );
          const cacheReadInputTokens = Number(
            usage.cache_read_input_tokens ?? 0,
          );
          const { data, error } = await supabase.rpc("record_coach_provider_metric", {
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
              prompt_cache_ttl: "5m",
              stable_prefix_cache_breakpoint: true,
            },
          });
          if (error) throw error;
          const usageRow = Array.isArray(data) ? data[0] : data;
          if (usageRow) {
            dailyUsage = {
              spent_usd: Number(usageRow.spent_usd ?? 0),
              budget_usd: Number(usageRow.budget_usd ?? COACH_LIMITS.maxDailyCostUsd),
              remaining_usd: Number(usageRow.remaining_usd ?? 0),
            };
          }
        }
      }
      await send({
        type: "turn_completed",
        turn_id: turn.turnId,
        state_version: nextStateVersion,
        state_fingerprint: finalFingerprint,
        workout_context: finalCompact,
        daily_usage: dailyUsage,
      });
    } catch (error) {
      const aborted = req.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      const providerTimedOut = error instanceof Error &&
        error.message === "Anthropic provider request timed out.";
      if (claimedTurn && !(!aborted && lastSuccessfulToolConfirmation)) {
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
      // A mutation/tool action may have already succeeded when the optional
      // post-tool model narration times out or fails validation. Preserve that
      // durable success instead of turning it into a misleading retry.
      if (!aborted && lastSuccessfulToolConfirmation) {
        console.warn("coach-turn completed with tool fallback", {
          turn_id: turn.turnId,
          tool_name: lastSuccessfulToolName,
          error: error instanceof Error ? error.message : String(error),
        });
        outputCharacters += lastSuccessfulToolConfirmation.length;
        emittedSpeech = true;
        await send({
          type: "text_delta",
          turn_id: turn.turnId,
          state_version: nextStateVersion,
          delta: ` ${lastSuccessfulToolConfirmation}`,
        });
        if (claimedTurn) {
          await supabase
            .from("coach_agent_turns")
            .update({
              status: "completed",
              state_version: nextStateVersion,
              output_chars: outputCharacters,
              completed_at: new Date().toISOString(),
            })
            .eq("id", claimedTurn.id);
        }
        await send({
          type: "turn_completed",
          turn_id: turn.turnId,
          state_version: nextStateVersion,
          state_fingerprint: initialFingerprint,
          workout_context: lastToolWorkoutContext,
        });
        return;
      }
      if (!aborted) {
        console.error("coach-turn error:", {
          turn_id: turn.turnId,
          mutation_applied: mutationApplied,
          error,
        });
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
