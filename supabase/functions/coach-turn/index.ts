import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildCompactContextSummary,
  buildRealtimeInstructions,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import {
  consumeResponsesSse,
  selectCoachResponseModel,
  validateCoachTurnRequest,
  type ResponsesFunctionCall,
} from "../_shared/coachResponse.ts";
import {
  generatedResponseTools,
  validateCoachToolArguments,
} from "../_shared/generated/coachTools.ts";
import { estimateResponsesCostUsd } from "../_shared/coachUsage.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 4;

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!OPENAI_API_KEY) return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
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
      409
    );
  }

  const { model, reasoningEffort } = selectCoachResponseModel(turn.transcript);
  const { data: claimedTurnId, error: claimError } = await supabase.rpc(
    "claim_coach_agent_turn",
    {
      p_user_id: userId,
      p_session_id: session.id,
      p_day_id: turn.dayId,
      p_turn_key: turn.turnId,
      p_state_version: turn.stateVersion,
      p_transcript: turn.transcript,
      p_model: model,
    }
  );
  if (claimError) {
    console.error("coach-turn claim failed:", claimError);
    return jsonResponse({ error: "Could not claim coach turn." }, 500);
  }
  if (!claimedTurnId) return jsonResponse({ error: "Coach turn already exists." }, 409);
  const claimedTurn = { id: String(claimedTurnId) };

  const initialContext = await loadWorkoutContext(supabase, userId, turn.dayId);
  if (!initialContext) return jsonResponse({ error: "Workout day not found" }, 404);
  const { data: answers } = await supabase
    .from("onboarding_answers")
    .select("main_goal")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: profile } = await supabase
    .from("profiles")
    .select("realtime_coach_voice")
    .eq("id", userId)
    .maybeSingle();
  const coachName =
    profile?.realtime_coach_voice === "cedar"
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
    turn.conversationSummary
  );
  const initialFingerprint = await sha256(compactContext);
  const instructions = `${buildRealtimeInstructions(
    initialContext,
    answers ?? null,
    undefined,
    turn.conversationSummary,
    coachName
  )}

RESPONSES PIPELINE
- The client already handles deterministic shots, timers, navigation, completion, and direct progress queries. Answer this unmatched turn only.
- Use tools for workout facts or changes. In a tool turn, emit no user-facing text before all tools succeed.
- After tool results, answer in one or two concise sentences. Never invent state or claim a change before its result.`;

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
    let input: unknown = [
      {
        role: "user",
        content: [{ type: "input_text", text: turn.transcript }],
      },
    ];
    let nextStateVersion = turn.stateVersion;
    let totalToolCalls = 0;
    let outputCharacters = 0;
    const usageEvents: Array<Record<string, unknown>> = [];
    try {
      await send({
        type: "turn_started",
        turn_id: turn.turnId,
        model,
        state_version: nextStateVersion,
        state_fingerprint: initialFingerprint,
      });
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: req.signal,
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Safety-Identifier": userId,
          },
          body: JSON.stringify({
            model,
            reasoning: { effort: reasoningEffort },
            instructions,
            input,
            ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
            tools: generatedResponseTools(),
            parallel_tool_calls: false,
            stream: true,
            max_output_tokens: 500,
          }),
        });
        if (!openAiResponse.ok || !openAiResponse.body) {
          const detail = await openAiResponse.text();
          throw new Error(`Responses API failed (${openAiResponse.status}): ${detail.slice(0, 300)}`);
        }
        const calls: ResponsesFunctionCall[] = [];
        let completedResponseId: string | null = null;
        await consumeResponsesSse(openAiResponse.body, {
          onTextDelta: (delta) => {
            outputCharacters += delta.length;
            return send({
              type: "text_delta",
              turn_id: turn.turnId,
              state_version: nextStateVersion,
              delta,
            });
          },
          onFunctionCall: (call) => {
            calls.push(call);
          },
          onCompleted: (responseId, usage) => {
            completedResponseId = responseId;
            if (usage) usageEvents.push(usage);
          },
        });
        previousResponseId = completedResponseId ?? previousResponseId;
        if (calls.length === 0) break;
        totalToolCalls += calls.length;
        if (totalToolCalls > MAX_TOOL_CALLS) throw new Error("Coach tool-call limit exceeded.");

        const outputs: Array<Record<string, unknown>> = [];
        for (const call of calls) {
          let toolArgs: unknown;
          try {
            toolArgs = JSON.parse(call.argumentsJson);
          } catch {
            throw new Error(`Invalid JSON arguments for ${call.name}.`);
          }
          const validated = validateCoachToolArguments(call.name, toolArgs);
          if (!validated.ok) throw new Error(validated.error);
          const clientRequestId = `${turn.turnId}:${call.callId || crypto.randomUUID()}`.slice(0, 200);
          const toolResponse = await fetch(`${SUPABASE_URL}/functions/v1/coach-tools`, {
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
          });
          const toolResult = await toolResponse.json().catch(() => ({}));
          if (!toolResponse.ok) {
            throw new Error(
              typeof toolResult?.error === "string" ? toolResult.error : "Coach tool failed."
            );
          }
          if (typeof toolResult.state_version === "number") {
            nextStateVersion = Math.max(nextStateVersion, toolResult.state_version);
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
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify({
              result: toolResult.result,
              state_version: nextStateVersion,
              workout: toolResult.updated_context ?? null,
            }),
          });
        }
        input = outputs;
      }

      const finalContext = await loadWorkoutContext(supabase, userId, turn.dayId);
      const finalCompact = finalContext
        ? buildCompactContextSummary(finalContext, answers ?? null, undefined)
        : compactContext;
      const finalFingerprint = await sha256(finalCompact);
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
      if (usageEvents.length) {
        for (const [index, usage] of usageEvents.entries()) {
          const inputTokens = Number(usage.input_tokens ?? 0);
          const outputTokens = Number(usage.output_tokens ?? 0);
          await supabase.rpc("record_coach_provider_metric", {
            p_user_id: userId,
            p_session_id: session.id,
            p_day_id: turn.dayId,
            p_turn_id: claimedTurn.id,
            p_provider: "openai",
            p_provider_request_id: `${turn.turnId}:responses:${index}`,
            p_metric: "responses_tokens",
            p_quantity: Math.max(0, inputTokens + outputTokens),
            p_unit: "tokens",
            p_estimated_cost_usd: estimateResponsesCostUsd({
              model: model as "gpt-5.6-luna" | "gpt-5.6-terra",
              inputTokens,
              outputTokens,
            }),
            p_metadata: usage,
          });
        }
      }
      await send({
        type: "turn_completed",
        turn_id: turn.turnId,
        state_version: nextStateVersion,
        state_fingerprint: finalFingerprint,
        workout_context: finalCompact,
      });
    } catch (error) {
      const aborted = req.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      await supabase
        .from("coach_agent_turns")
        .update({
          status: aborted ? "cancelled" : "failed",
          error_code: aborted ? "client_cancelled" : "turn_failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", claimedTurn.id);
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

