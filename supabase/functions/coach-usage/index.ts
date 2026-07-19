// Supabase Edge Function: coach-usage
// Persists per-session Realtime usage totals reported by the client.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { estimateRealtimeCostUsd } from "../_shared/coachUsage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function boundedCount(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
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

    const body = (await req.json().catch(() => ({}))) as {
      day_id?: string | null;
      session_key?: string;
      model?: string;
      response_count?: number;
      session_duration_ms?: number;
      input_text_tokens?: number;
      cached_input_tokens?: number;
      cached_text_tokens?: number;
      cached_audio_tokens?: number;
      input_audio_tokens?: number;
      output_text_tokens?: number;
      output_audio_tokens?: number;
      finalize_session?: boolean;
    };

    if (!body.session_key) return jsonResponse({ error: "session_key is required" }, 400);
    if (body.session_key.length < 16 || body.session_key.length > 128) {
      return jsonResponse({ error: "Invalid session key" }, 400);
    }
    const { data: session } = await supabase
      .from("coach_sessions")
      .select("id, day_id, model, started_at, ended_at")
      .eq("session_key", body.session_key)
      .eq("user_id", userId)
      .maybeSingle();
    if (!session) return jsonResponse({ error: "Coach session not found" }, 404);

    const usage = {
      input_text_tokens: boundedCount(body.input_text_tokens, 10_000_000),
      cached_text_tokens: boundedCount(
        body.cached_text_tokens ?? body.cached_input_tokens,
        10_000_000
      ),
      cached_audio_tokens: boundedCount(body.cached_audio_tokens, 10_000_000),
      input_audio_tokens: boundedCount(body.input_audio_tokens, 10_000_000),
      output_text_tokens: boundedCount(body.output_text_tokens, 10_000_000),
      output_audio_tokens: boundedCount(body.output_audio_tokens, 10_000_000),
    };
    const estimatedCost = estimateRealtimeCostUsd(usage);
    const maxObservedDuration = Math.max(
      0,
      Date.now() - new Date(session.started_at).getTime() + 60_000
    );

    const { data: dailyUsage, error: usageError } = await supabase.rpc("record_coach_usage", {
      p_user_id: userId,
      p_session_key: body.session_key,
      p_day_id: session.day_id,
      p_model: session.model,
      p_response_count: boundedCount(body.response_count, 100_000),
      p_session_duration_ms: Math.min(
        boundedCount(body.session_duration_ms, 86_400_000),
        maxObservedDuration
      ),
      p_input_text_tokens: usage.input_text_tokens,
      p_cached_input_tokens: usage.cached_text_tokens + usage.cached_audio_tokens,
      p_input_audio_tokens: usage.input_audio_tokens,
      p_output_text_tokens: usage.output_text_tokens,
      p_output_audio_tokens: usage.output_audio_tokens,
      p_estimated_cost_usd: estimatedCost,
    });
    if (usageError) throw usageError;
    const daily = Array.isArray(dailyUsage) ? dailyUsage[0] : dailyUsage;

    if (body.finalize_session && !session.ended_at) {
      await supabase
        .from("coach_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("user_id", userId)
        .is("ended_at", null);
    }

    return jsonResponse({
      estimated_cost_usd: estimatedCost,
      daily_usage: daily,
      code: Number(daily?.remaining_usd ?? 0) <= 0 ? "daily_budget_exhausted" : undefined,
      logged: true,
    });
  } catch (err) {
    console.error("coach-usage error:", err);
    return jsonResponse({ error: "Could not record coach usage" }, 500);
  }
});
