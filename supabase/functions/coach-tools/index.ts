// Supabase Edge Function: coach-tools
// Executes coach tool calls with idempotency and session limits.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildRealtimeInstructions,
  buildRealtimeNavigationUpdate,
  executeCoachTool,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const body = (await req.json().catch(() => ({}))) as {
      day_id?: string;
      session_key?: string;
      tool_name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (!body.tool_name) return jsonResponse({ error: "tool_name is required" }, 400);

    const args = { ...(body.arguments ?? {}) };
    let clientRequestId =
      typeof args.client_request_id === "string" ? args.client_request_id : null;

    const idempotentTools = new Set([
      "save_shooting_results",
      "set_set_completion",
      "complete_drill",
      "uncomplete_drill",
      "skip_drill",
      "save_note",
      "extend_workout",
      "shorten_workout",
      "finish_workout",
      "start_timer",
      "pause_timer",
      "resume_timer",
      "stop_timer",
    ]);

    if (!clientRequestId && idempotentTools.has(body.tool_name)) {
      clientRequestId = `${body.tool_name}-${userId}-${crypto.randomUUID()}`;
      args.client_request_id = clientRequestId;
    }

    if (clientRequestId) {
      const { data: cached } = await supabase
        .from("coach_tool_requests")
        .select("result, db_changed, client_action, local_confirmation, skip_model_response")
        .eq("user_id", userId)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();

      if (cached) {
        const refreshedContext = cached.db_changed || body.tool_name === "get_workout_position"
          ? await loadWorkoutContext(supabase, userId, body.day_id)
          : null;
        return jsonResponse({
          result: cached.result,
          client_action: cached.client_action,
          db_changed: cached.db_changed,
          local_confirmation: cached.local_confirmation,
          skip_model_response: cached.skip_model_response,
          deduplicated: true,
          updated_context: refreshedContext ? buildRealtimeNavigationUpdate(refreshedContext) : null,
          updated_instructions: refreshedContext
            ? buildRealtimeInstructions(refreshedContext, answers ?? null)
            : null,
        });
      }
    }

    if (body.session_key) {
      const { data: session } = await supabase
        .from("coach_sessions")
        .select("id, response_count, expires_at, ended_at")
        .eq("session_key", body.session_key)
        .eq("user_id", userId)
        .maybeSingle();

      if (!session || session.ended_at) {
        return jsonResponse({ error: "Coach session is not active." }, 409);
      }
    }

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);

    const outcome = await executeCoachTool(
      supabase,
      userId,
      body.day_id,
      ctx,
      body.tool_name,
      args
    );

    if (clientRequestId) {
      await supabase.from("coach_tool_requests").insert({
        user_id: userId,
        day_id: body.day_id,
        client_request_id: clientRequestId,
        tool_name: body.tool_name,
        result: outcome.result,
        db_changed: outcome.dbChanged,
        client_action: outcome.clientAction ?? null,
        local_confirmation: outcome.localConfirmation ?? null,
        skip_model_response: outcome.skipModelResponse ?? false,
      });
    }

    if (body.session_key) {
      const { data: session } = await supabase
        .from("coach_sessions")
        .select("id, response_count")
        .eq("session_key", body.session_key)
        .eq("user_id", userId)
        .maybeSingle();

      if (session) {
        await supabase
          .from("coach_sessions")
          .update({ response_count: (session.response_count ?? 0) + 1 })
          .eq("id", session.id);
      }
    }

    const refreshedContext = outcome.dbChanged || body.tool_name === "get_workout_position"
      ? await loadWorkoutContext(supabase, userId, body.day_id)
      : null;

    return jsonResponse({
      result: outcome.result,
      client_action: outcome.clientAction ?? null,
      db_changed: outcome.dbChanged,
      local_confirmation: outcome.localConfirmation ?? null,
      skip_model_response: outcome.skipModelResponse ?? false,
      updated_context: refreshedContext ? buildRealtimeNavigationUpdate(refreshedContext) : null,
      updated_instructions: refreshedContext
        ? buildRealtimeInstructions(refreshedContext, answers ?? null)
        : null,
    });
  } catch (err) {
    console.error("coach-tools error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
