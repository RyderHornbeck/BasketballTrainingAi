// Supabase Edge Function: coach-realtime
// ----------------------------------------------------------------------------
// Establishes an OpenAI Realtime API WebRTC session for the voice coach.
//
// The client sends its WebRTC SDP offer plus workout context; this function
// forwards it to OpenAI's unified /v1/realtime/calls endpoint with a fully
// configured session (instructions, tools, semantic VAD, voice).
//
// Deploy: supabase functions deploy coach-realtime
// Requires: OPENAI_API_KEY
// Optional: OPENAI_REALTIME_MODEL (default gpt-4o-mini-realtime-preview)
//           OPENAI_REALTIME_VOICE (default marin)
// ----------------------------------------------------------------------------

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  COACH_SYSTEM_PROMPT,
  buildContextSummary,
  buildRealtimeSessionConfig,
  loadWorkoutContext,
  type TimerState,
} from "../_shared/coachCore.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const REALTIME_MODEL =
  Deno.env.get("OPENAI_REALTIME_MODEL") ?? "gpt-4o-mini-realtime-preview";
const REALTIME_VOICE = Deno.env.get("OPENAI_REALTIME_VOICE") ?? "marin";
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
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
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
      sdp?: string;
      timer?: TimerState;
    };

    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (!body.sdp) return jsonResponse({ error: "sdp is required" }, 400);

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);

    const { data: answers } = await supabase
      .from("onboarding_answers")
      .select(
        "overall_skill_level, main_goal, position, strengths, weaknesses, preferred_intensity, minutes_per_workout"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const contextJson = buildContextSummary(ctx, answers ?? null, body.timer);
    const instructions = `${COACH_SYSTEM_PROMPT}\n\nCurrent workout context:\n${contextJson}`;

    const sessionConfig = buildRealtimeSessionConfig(
      instructions,
      REALTIME_MODEL,
      REALTIME_VOICE
    );

    const form = new FormData();
    form.set("sdp", body.sdp);
    form.set("session", JSON.stringify(sessionConfig));

    const openaiRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Safety-Identifier": userId,
      },
      body: form,
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error(`OpenAI realtime/calls failed (${openaiRes.status}):`, errText.slice(0, 500));
      return jsonResponse(
        { error: `Realtime session failed (${openaiRes.status})` },
        502
      );
    }

    const answerSdp = await openaiRes.text();
    return jsonResponse({ sdp: answerSdp });
  } catch (err) {
    console.error("coach-realtime error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
