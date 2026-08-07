// Supabase Edge Function: coach-tools
// Executes coach tool calls with idempotency and session limits.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildCompactContextSummary,
  buildRealtimeInstructions,
  buildRealtimeNavigationUpdate,
  executeCoachTool,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import {
  COACH_IDEMPOTENT_TOOLS,
  COACH_READ_ONLY_TOOLS,
  COACH_SERVER_TOOL_NAMES,
  validateCoachToolArguments,
} from "../_shared/generated/coachTools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COACH_NAME_BY_VOICE: Record<string, string> = {
  ash: "Coach Tyler",
  cedar: "Coach Devin",
  marin: "Coach Maya",
  shimmer: "Coach Ava",
};
// These actions have complete athlete-facing results and never require a
// follow-up tool. Returning them exactly removes a fragile second LLM request
// after a timer control or committed workout change.
const EXACT_CONFIRMATION_TOOLS = new Set([
  "start_timer",
  "pause_timer",
  "resume_timer",
  "stop_timer",
  "add_workout_exercise",
  "remove_workout_exercise",
  "save_note",
  "set_set_completion",
  "complete_drill",
  "uncomplete_drill",
  "finish_workout",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;
    const { data: answers } = await supabase
      .from("onboarding_answers")
      .select("main_goal")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: coachProfile } = await supabase
      .from("profiles")
      .select("realtime_coach_voice")
      .eq("id", userId)
      .maybeSingle();
    const coachName = COACH_NAME_BY_VOICE[coachProfile?.realtime_coach_voice ?? ""] ?? "Coach Tyler";

    const body = (await req.json().catch(() => ({}))) as {
      day_id?: string;
      session_key?: string;
      tool_name?: string;
      arguments?: Record<string, unknown>;
      refresh_context?: boolean;
    };

    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (!body.tool_name) return jsonResponse({ error: "tool_name is required" }, 400);
    if (!body.session_key) return jsonResponse({ error: "session_key is required" }, 400);
    if (
      body.day_id.length > 64
      || body.session_key.length < 16
      || body.session_key.length > 128
      || body.tool_name.length > 80
    ) {
      return jsonResponse({ error: "Invalid tool request" }, 400);
    }

    if (!COACH_SERVER_TOOL_NAMES.has(body.tool_name)) {
      return jsonResponse({ error: "Unsupported tool" }, 400);
    }
    const validated = validateCoachToolArguments(body.tool_name, body.arguments ?? {});
    if (!validated.ok) {
      return jsonResponse(
        { error: validated.error, code: "invalid_tool_arguments" },
        400
      );
    }
    const args = { ...validated.value };
    let clientRequestId =
      typeof args.client_request_id === "string" ? args.client_request_id : null;

    if (!clientRequestId && COACH_IDEMPOTENT_TOOLS.has(body.tool_name)) {
      clientRequestId = `${body.tool_name}-${userId}-${crypto.randomUUID()}`;
      args.client_request_id = clientRequestId;
    }

    if (clientRequestId && (clientRequestId.length < 8 || clientRequestId.length > 200)) {
      return jsonResponse({ error: "Invalid client request ID" }, 400);
    }

    let claimedRequestId: string | null = null;
    if (clientRequestId) {
      const { data: claimed, error: claimError } = await supabase
        .from("coach_tool_requests")
        .upsert(
          {
            user_id: userId,
            day_id: body.day_id,
            client_request_id: clientRequestId,
            tool_name: body.tool_name,
            result: "",
            processing_status: "processing",
          },
          {
            onConflict: "user_id,client_request_id",
            ignoreDuplicates: true,
          }
        )
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      claimedRequestId = claimed?.id ?? null;

      if (!claimedRequestId) {
        const { data: cached } = await supabase
          .from("coach_tool_requests")
          .select(
            "day_id, tool_name, result, db_changed, client_action, local_confirmation, skip_model_response, processing_status"
          )
          .eq("user_id", userId)
          .eq("client_request_id", clientRequestId)
          .maybeSingle();
        if (!cached) return jsonResponse({ error: "Unable to claim tool request" }, 409);
        if (cached.day_id !== body.day_id || cached.tool_name !== body.tool_name) {
          return jsonResponse({ error: "Request ID was already used for a different action" }, 409);
        }
        if (cached.processing_status === "processing") {
          return jsonResponse({ error: "Tool request is already processing" }, 409);
        }
        if (cached.processing_status === "failed") {
          return jsonResponse({ error: "Earlier tool request failed" }, 409);
        }
        const refreshedContext = cached.db_changed
          ? await loadWorkoutContext(supabase, userId, body.day_id)
          : null;
        const contextJson = refreshedContext
          ? buildCompactContextSummary(refreshedContext, answers ?? null, undefined)
          : null;
        return jsonResponse({
          ok: true,
          status: "succeeded",
          result: cached.result,
          say: cached.local_confirmation ?? cached.result,
          continuation: cached.skip_model_response
            ? "none"
            : "model",
          client_action: cached.client_action,
          db_changed: cached.db_changed,
          local_confirmation: cached.local_confirmation,
          skip_model_response: cached.skip_model_response,
          deduplicated: true,
          updated_context: refreshedContext ? buildRealtimeNavigationUpdate(refreshedContext) : null,
          client_workout_context: contextJson,
          snapshot_id: contextJson
            ? (JSON.parse(contextJson) as { snapshot_id?: string }).snapshot_id ?? null
            : null,
          updated_instructions: refreshedContext
            && (cached.db_changed || body.refresh_context)
            ? buildRealtimeInstructions(refreshedContext, answers ?? null, undefined, undefined, coachName)
            : null,
          tool_kind: cached.db_changed ? "mutation" : "read_only",
          requires_spoken_confirmation: cached.db_changed,
        });
      }
    }

    const { data: activeSession } = await supabase
      .from("coach_sessions")
      .select("id, day_id, expires_at, ended_at, state_version")
      .eq("session_key", body.session_key)
      .eq("user_id", userId)
      .maybeSingle();
    if (
      !activeSession
      || activeSession.day_id !== body.day_id
      || activeSession.ended_at
      || new Date(activeSession.expires_at).getTime() <= Date.now()
    ) {
      return jsonResponse({ error: "Coach session is not active." }, 409);
    }

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);

    let outcome;
    try {
      outcome = await executeCoachTool(
        supabase,
        userId,
        body.day_id,
        ctx,
        body.tool_name,
        args
      );
    } catch (toolError) {
      if (claimedRequestId) {
        await supabase
          .from("coach_tool_requests")
          .update({
            processing_status: "failed",
            result: "Tool execution failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimedRequestId)
          .eq("user_id", userId);
      }
      throw toolError;
    }

    let stateVersion = Number(activeSession.state_version ?? 0);
    if (outcome.dbChanged) {
      const { data: advancedVersion, error: stateError } = await supabase.rpc(
        "advance_coach_session_state",
        {
          p_session_id: activeSession.id,
          p_user_id: userId,
        }
      );
      if (stateError) throw stateError;
      stateVersion = Number(advancedVersion ?? stateVersion + 1);
    }

    if (claimedRequestId) {
      const { error: completionError } = await supabase
        .from("coach_tool_requests")
        .update({
          result: outcome.result,
          db_changed: outcome.dbChanged,
          client_action: outcome.clientAction ?? null,
          local_confirmation: outcome.localConfirmation ?? null,
          skip_model_response: outcome.skipModelResponse ?? false,
          processing_status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimedRequestId)
        .eq("user_id", userId);
      if (completionError) throw completionError;
    }

    await supabase.rpc("increment_coach_session_response", {
      p_session_id: activeSession.id,
      p_user_id: userId,
    });

    const refreshedContext = outcome.dbChanged
      ? await loadWorkoutContext(supabase, userId, body.day_id)
      : ctx;
    const toolKind = COACH_READ_ONLY_TOOLS.has(body.tool_name) ? "read_only" : "mutation";
    const speakExact = !outcome.skipModelResponse &&
      EXACT_CONFIRMATION_TOOLS.has(body.tool_name) &&
      !outcome.result.startsWith("Error:");
    const contextJson = refreshedContext
      ? buildCompactContextSummary(refreshedContext, answers ?? null, undefined)
      : null;

    return jsonResponse({
      ok: true,
      status: "succeeded",
      result: outcome.result,
      say: outcome.localConfirmation ?? outcome.result,
      continuation: outcome.skipModelResponse
        ? "none"
        : speakExact
        ? "speak_exact"
        : "model",
      client_action: outcome.clientAction ?? null,
      db_changed: outcome.dbChanged,
      local_confirmation: outcome.localConfirmation ?? null,
      skip_model_response: outcome.skipModelResponse ?? false,
      updated_context: refreshedContext
        ? buildRealtimeNavigationUpdate(
            refreshedContext,
            outcome.dbChanged ? ctx : undefined
          )
        : null,
      client_workout_context: contextJson,
      snapshot_id: contextJson
        ? (JSON.parse(contextJson) as { snapshot_id?: string }).snapshot_id ?? null
        : null,
      updated_instructions: refreshedContext
        && (outcome.dbChanged || body.refresh_context)
        ? buildRealtimeInstructions(refreshedContext, answers ?? null, undefined, undefined, coachName)
        : null,
      tool_kind: toolKind,
      requires_spoken_confirmation: toolKind === "mutation" && !outcome.skipModelResponse,
      state_version: stateVersion,
    });
  } catch (err) {
    console.error("coach-tools error:", err);
    return jsonResponse({ error: "Coach tool request failed" }, 500);
  }
});
