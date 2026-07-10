// Supabase Edge Function: coach-tools
// ----------------------------------------------------------------------------
// Executes a single coach tool call from the OpenAI Realtime data channel.
// Called by the client when the model invokes a function during a live session.
//
// Deploy: supabase functions deploy coach-tools
// ----------------------------------------------------------------------------

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { executeCoachTool, loadWorkoutContext } from "../_shared/coachCore.ts";

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
      day_id?: string;
      tool_name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (!body.tool_name) return jsonResponse({ error: "tool_name is required" }, 400);

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);

    const outcome = await executeCoachTool(
      supabase,
      userId,
      body.day_id,
      ctx,
      body.tool_name,
      body.arguments ?? {}
    );

    return jsonResponse({
      result: outcome.result,
      client_action: outcome.clientAction ?? null,
      db_changed: outcome.dbChanged,
    });
  } catch (err) {
    console.error("coach-tools error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
