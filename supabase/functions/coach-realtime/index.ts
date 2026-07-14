// Supabase Edge Function: coach-realtime
// Establishes a short-lived OpenAI Realtime WebRTC session on demand.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildCompactContextSummary,
  buildRealtimeInstructions,
  buildRealtimeSessionConfig,
  loadWorkoutContext,
  type TimerState,
} from "../_shared/coachCore.ts";
import {
  COACH_LIMITS,
  DEFAULT_REALTIME_MODEL,
  utcDayStart,
} from "../_shared/coachUsage.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") ?? DEFAULT_REALTIME_MODEL;
const REALTIME_VOICE = Deno.env.get("OPENAI_REALTIME_VOICE") ?? "marin";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getDailyUsageTotals(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const dayStart = utcDayStart();
  const { data } = await supabase
    .from("coach_usage_logs")
    .select("response_count, estimated_cost_usd")
    .eq("user_id", userId)
    .gte("created_at", dayStart);

  let responses = 0;
  let cost = 0;
  for (const row of data ?? []) {
    responses += row.response_count ?? 0;
    cost += Number(row.estimated_cost_usd ?? 0);
  }
  return { responses, cost };
}

async function getWorkoutUsageTotals(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  dayId: string
) {
  const { data } = await supabase
    .from("coach_usage_logs")
    .select("response_count, estimated_cost_usd")
    .eq("user_id", userId)
    .eq("day_id", dayId);

  let responses = 0;
  let cost = 0;
  for (const row of data ?? []) {
    responses += row.response_count ?? 0;
    cost += Number(row.estimated_cost_usd ?? 0);
  }
  return { responses, cost };
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
      audio_profile?: "bluetooth" | "speaker";
      session_key?: string;
      conversation_summary?: string;
    };

    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (!body.sdp) return jsonResponse({ error: "sdp is required" }, 400);
    if (!body.session_key) return jsonResponse({ error: "session_key is required" }, 400);

    const daily = await getDailyUsageTotals(supabase, userId);
    if (daily.responses >= COACH_LIMITS.maxResponsesPerDay) {
      return jsonResponse(
        {
          error: "Daily coach response limit reached.",
          code: "daily_response_limit",
        },
        429
      );
    }
    if (daily.cost >= COACH_LIMITS.maxDailyCostUsd) {
      return jsonResponse(
        {
          error: "Daily coach cost limit reached.",
          code: "daily_budget_exhausted",
          daily_usage: {
            spent_usd: daily.cost,
            budget_usd: COACH_LIMITS.maxDailyCostUsd,
            remaining_usd: 0,
          },
        },
        429
      );
    }

    const workout = await getWorkoutUsageTotals(supabase, userId, body.day_id);
    if (workout.responses >= COACH_LIMITS.maxResponsesPerWorkout) {
      return jsonResponse(
        {
          error: "Workout coach response limit reached.",
          code: "workout_response_limit",
        },
        429
      );
    }
    if (workout.cost >= COACH_LIMITS.maxWorkoutCostUsd) {
      return jsonResponse(
        {
          error: "Workout coach cost limit reached.",
          code: "workout_budget_exhausted",
          workout_usage: {
            spent_usd: workout.cost,
            budget_usd: COACH_LIMITS.maxWorkoutCostUsd,
            remaining_usd: 0,
          },
        },
        429
      );
    }

    const { data: existingSession } = await supabase
      .from("coach_sessions")
      .select("id, response_count, expires_at, ended_at")
      .eq("session_key", body.session_key)
      .maybeSingle();

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);

    const { data: answers } = await supabase
      .from("onboarding_answers")
      .select("main_goal")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const contextJson = buildCompactContextSummary(
      ctx,
      answers ?? null,
      body.timer,
      body.conversation_summary
    );

    const sessionConfig = buildRealtimeSessionConfig(
      buildRealtimeInstructions(ctx, answers ?? null, body.timer, body.conversation_summary),
      REALTIME_MODEL,
      REALTIME_VOICE,
      body.audio_profile === "speaker" ? "speaker" : "bluetooth"
    );

    // This is retained as a database session-validity timestamp, not a coach
    // conversation limit. Workout/day limits are enforced separately above.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("coach_sessions").upsert(
      {
        user_id: userId,
        day_id: body.day_id,
        session_key: body.session_key,
        model: REALTIME_MODEL,
        response_count: existingSession?.response_count ?? 0,
        workout_response_count: workout.responses,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
        ended_at: null,
      },
      { onConflict: "session_key" }
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
      let detail: string | undefined;
      try {
        const parsed = JSON.parse(errText) as { error?: { message?: string } };
        detail = parsed.error?.message;
      } catch {
        detail = errText.slice(0, 200) || undefined;
      }
      return jsonResponse(
        {
          error: `Realtime session failed (${openaiRes.status})`,
          detail,
        },
        502
      );
    }

    const answerSdp = await openaiRes.text();
    return jsonResponse({
      sdp: answerSdp,
      session_key: body.session_key,
      model: REALTIME_MODEL,
      workout_context: contextJson,
      limits: COACH_LIMITS,
      workout_usage: {
        spent_usd: workout.cost,
        budget_usd: COACH_LIMITS.maxWorkoutCostUsd,
        remaining_usd: Math.max(0, COACH_LIMITS.maxWorkoutCostUsd - workout.cost),
      },
      daily_usage: {
        spent_usd: daily.cost,
        budget_usd: COACH_LIMITS.maxDailyCostUsd,
        remaining_usd: Math.max(0, COACH_LIMITS.maxDailyCostUsd - daily.cost),
      },
    });
  } catch (err) {
    console.error("coach-realtime error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
