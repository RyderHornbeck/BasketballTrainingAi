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
} from "../_shared/coachUsage.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") ?? DEFAULT_REALTIME_MODEL;
const DEFAULT_REALTIME_VOICE = Deno.env.get("OPENAI_REALTIME_VOICE") ?? "ash";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_REALTIME_VOICES = new Set(["ash", "cedar", "marin", "shimmer"]);
const COACH_NAME_BY_VOICE: Record<string, string> = {
  ash: "Coach Tyler",
  cedar: "Coach Devin",
  marin: "Coach Maya",
  shimmer: "Coach Ava",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getDailyUsageTotals(
  supabase: any,
  userId: string,
  timezone: string | null
) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const parts = formatter.formatToParts(new Date());
  const localDate = `${parts.find((part) => part.type === "year")?.value}-${parts.find(
    (part) => part.type === "month"
  )?.value}-${parts.find((part) => part.type === "day")?.value}`;
  const { data } = await supabase
    .from("coach_daily_usage")
    .select("spent_usd")
    .eq("user_id", userId)
    .eq("usage_date", localDate)
    .maybeSingle();
  return Number((data as { spent_usd?: number } | null)?.spent_usd ?? 0);
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
    if (body.day_id.length > 64 || body.session_key.length < 16 || body.session_key.length > 128) {
      return jsonResponse({ error: "Invalid session parameters" }, 400);
    }
    if (body.sdp.length > 2_000_000) return jsonResponse({ error: "SDP payload is too large" }, 413);
    if ((body.conversation_summary?.length ?? 0) > 8_000) {
      return jsonResponse({ error: "Conversation summary is too large" }, 413);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("timezone, realtime_coach_voice")
      .eq("id", userId)
      .maybeSingle();
    const realtimeVoice = ALLOWED_REALTIME_VOICES.has(profile?.realtime_coach_voice ?? "")
      ? profile!.realtime_coach_voice
      : DEFAULT_REALTIME_VOICE;
    const dailySpent = await getDailyUsageTotals(supabase, userId, profile?.timezone ?? null);
    if (dailySpent >= COACH_LIMITS.maxDailyCostUsd) {
      return jsonResponse(
        {
          error: "Daily coach credit is used up.",
          code: "daily_budget_exhausted",
          daily_usage: {
            spent_usd: dailySpent,
            budget_usd: COACH_LIMITS.maxDailyCostUsd,
            remaining_usd: 0,
          },
        },
        429
      );
    }

    const { data: existingSession } = await supabase
      .from("coach_sessions")
      .select("id, user_id, day_id, response_count, expires_at, ended_at")
      .eq("session_key", body.session_key)
      .maybeSingle();
    if (
      existingSession
      && (existingSession.user_id !== userId || existingSession.day_id !== body.day_id)
    ) {
      return jsonResponse({ error: "Session key is already bound to another workout." }, 409);
    }

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
    const { data: reservationRows, error: reservationError } = await supabase.rpc(
      "reserve_coach_session_usage",
      {
        p_user_id: userId,
        p_session_key: body.session_key,
        p_day_id: body.day_id,
        p_model: REALTIME_MODEL,
        p_reservation_usd: 0.0025,
      }
    );
    if (reservationError) throw reservationError;
    const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
    if (!reservation?.allowed) {
      return jsonResponse(
        {
          error: "Daily coach credit is used up.",
          code: "daily_budget_exhausted",
          daily_usage: reservation,
        },
        429
      );
    }

    const sessionConfig = buildRealtimeSessionConfig(
      buildRealtimeInstructions(
        ctx,
        answers ?? null,
        body.timer,
        body.conversation_summary,
        COACH_NAME_BY_VOICE[realtimeVoice] ?? "Coach Tyler"
      ),
      REALTIME_MODEL,
      realtimeVoice,
      body.audio_profile === "speaker" ? "speaker" : "bluetooth"
    );

    // This is retained as a database session-validity timestamp, not a coach
    // conversation limit. Workout/day limits are enforced separately above.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sessionValues = {
        user_id: userId,
        day_id: body.day_id,
        session_key: body.session_key,
        model: REALTIME_MODEL,
        response_count: existingSession?.response_count ?? 0,
        workout_response_count: 0,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
        ended_at: null,
      };
    const sessionWrite = existingSession
      ? supabase.from("coach_sessions").update(sessionValues).eq("id", existingSession.id)
      : supabase.from("coach_sessions").insert(sessionValues);
    const { error: sessionWriteError } = await sessionWrite;
    if (sessionWriteError) throw sessionWriteError;

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
      voice: realtimeVoice,
      workout_context: contextJson,
      limits: COACH_LIMITS,
      daily_usage: {
        spent_usd: dailySpent,
        budget_usd: COACH_LIMITS.maxDailyCostUsd,
        remaining_usd: Math.max(0, COACH_LIMITS.maxDailyCostUsd - dailySpent),
      },
    });
  } catch (err) {
    console.error("coach-realtime error:", err);
    return jsonResponse({ error: "Could not start coach session" }, 500);
  }
});
