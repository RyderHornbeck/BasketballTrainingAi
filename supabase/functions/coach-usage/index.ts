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
    };

    if (!body.session_key) return jsonResponse({ error: "session_key is required" }, 400);

    const usage = {
      input_text_tokens: body.input_text_tokens ?? 0,
      cached_text_tokens: body.cached_text_tokens ?? body.cached_input_tokens ?? 0,
      cached_audio_tokens: body.cached_audio_tokens ?? 0,
      input_audio_tokens: body.input_audio_tokens ?? 0,
      output_text_tokens: body.output_text_tokens ?? 0,
      output_audio_tokens: body.output_audio_tokens ?? 0,
    };
    const estimatedCost = estimateRealtimeCostUsd(usage);

    const { error: usageError } = await supabase.from("coach_usage_logs").upsert(
      {
        user_id: userId,
        day_id: body.day_id ?? null,
        session_key: body.session_key,
        model: body.model ?? null,
        response_count: body.response_count ?? 0,
        session_duration_ms: body.session_duration_ms ?? 0,
        input_text_tokens: usage.input_text_tokens,
        cached_input_tokens: usage.cached_text_tokens + usage.cached_audio_tokens,
        input_audio_tokens: usage.input_audio_tokens,
        output_text_tokens: usage.output_text_tokens,
        output_audio_tokens: usage.output_audio_tokens,
        estimated_cost_usd: estimatedCost,
      },
      { onConflict: "session_key" }
    );
    if (usageError) throw usageError;

    if (body.session_key) {
      await supabase
        .from("coach_sessions")
        .update({
          ended_at: new Date().toISOString(),
          response_count: body.response_count ?? 0,
        })
        .eq("session_key", body.session_key)
        .eq("user_id", userId);
    }

    return jsonResponse({
      estimated_cost_usd: estimatedCost,
      logged: true,
    });
  } catch (err) {
    console.error("coach-usage error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
