import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { estimateCartesiaCostUsd } from "../_shared/coachUsage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USD_PER_MILLION_CREDITS = Number(
  Deno.env.get("CARTESIA_USD_PER_MILLION_CREDITS") ?? 37.375
);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const dayId = typeof body?.day_id === "string" ? body.day_id : "";
  const sessionKey = typeof body?.session_key === "string" ? body.session_key : "";
  const requestId = typeof body?.request_id === "string" ? body.request_id : "";
  const sttSeconds = Number(body?.stt_audio_seconds ?? 0);
  const ttsCharacters = Number(body?.tts_characters ?? 0);
  if (
    !dayId ||
    dayId.length > 64 ||
    sessionKey.length < 16 ||
    sessionKey.length > 128 ||
    requestId.length < 8 ||
    requestId.length > 120 ||
    !SAFE_ID.test(requestId) ||
    !Number.isFinite(sttSeconds) ||
    sttSeconds < 0 ||
    sttSeconds > 600 ||
    !Number.isInteger(ttsCharacters) ||
    ttsCharacters < 0 ||
    ttsCharacters > 20_000 ||
    (sttSeconds === 0 && ttsCharacters === 0)
  ) {
    return jsonResponse({ error: "Invalid provider usage report" }, 400);
  }
  const userId = userData.user.id;
  const { data: session } = await supabase
    .from("coach_sessions")
    .select("id, day_id, ended_at, expires_at")
    .eq("session_key", sessionKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (!session || session.day_id !== dayId) {
    return jsonResponse({ error: "Coach session was not found" }, 404);
  }

  let latest:
    | { spent_usd?: number; budget_usd?: number; remaining_usd?: number }
    | null = null;
  const metrics = [
    ...(sttSeconds > 0
      ? [
          {
            suffix: "stt",
            metric: "ink2_audio",
            quantity: sttSeconds,
            unit: "seconds",
            cost: estimateCartesiaCostUsd({
              sttAudioSeconds: sttSeconds,
              usdPerMillionCredits: USD_PER_MILLION_CREDITS,
            }),
          },
        ]
      : []),
    ...(ttsCharacters > 0
      ? [
          {
            suffix: "tts",
            metric: "sonic35_text",
            quantity: ttsCharacters,
            unit: "characters",
            cost: estimateCartesiaCostUsd({
              ttsCharacters,
              usdPerMillionCredits: USD_PER_MILLION_CREDITS,
            }),
          },
        ]
      : []),
  ];
  try {
    for (const metric of metrics) {
      const { data, error } = await supabase.rpc("record_coach_provider_metric", {
        p_user_id: userId,
        p_session_id: session.id,
        p_day_id: dayId,
        p_turn_id: null,
        p_provider: "cartesia",
        p_provider_request_id: `${requestId}:${metric.suffix}`,
        p_metric: metric.metric,
        p_quantity: metric.quantity,
        p_unit: metric.unit,
        p_estimated_cost_usd: metric.cost,
        p_metadata: {},
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) latest = row;
    }
  } catch (error) {
    console.error("coach-provider-usage error:", error);
    return jsonResponse({ error: "Could not record provider usage" }, 500);
  }
  return jsonResponse({
    recorded: true,
    daily_usage: {
      spent_usd: Number(latest?.spent_usd ?? 0),
      budget_usd: Number(latest?.budget_usd ?? 0.85),
      remaining_usd: Number(latest?.remaining_usd ?? 0),
    },
  });
});

