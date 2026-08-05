// Supabase Edge Function: coach-tts
// Proxies bounded deterministic confirmations to OpenAI Speech as streaming PCM.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  estimateTtsCostUsd,
  TTS_MAX_REQUESTS_PER_MINUTE,
  TTS_MAX_REQUESTS_PER_SESSION,
  TTS_MODEL,
  validateTtsRequest,
} from "../_shared/coachUsage.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_TTS_VOICES = new Set([
  "ash",
  "cedar",
  "marin",
  "shimmer",
  "coral",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  const startedAt = performance.now();
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
  let userId: string | undefined;
  let requestId: string | undefined;
  let reserved = false;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(
      jwt,
    );
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    userId = userData.user.id;
    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }

    const validation = validateTtsRequest(await req.json().catch(() => null));
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);
    const { text, requestId: validatedRequestId, sessionKey } =
      validation.value;
    requestId = validatedRequestId;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("realtime_coach_voice")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const voice = profile?.realtime_coach_voice;
    // Coral is accepted only when it is authoritative profile data; the
    // database voice constraint determines whether that value is supported.
    if (typeof voice !== "string" || !ALLOWED_TTS_VOICES.has(voice)) {
      return jsonResponse(
        { error: "Profile has no supported coach voice" },
        409,
      );
    }

    const estimatedCost = estimateTtsCostUsd(text);
    const fingerprint = await sha256(text);
    const { data: reservationRows, error: reservationError } = await supabase
      .rpc(
        "reserve_coach_tts_usage",
        {
          p_user_id: userId,
          p_session_key: sessionKey,
          p_request_id: requestId,
          p_text_sha256: fingerprint,
          p_text_length: text.length,
          p_model: TTS_MODEL,
          p_voice: voice,
          p_estimated_cost_usd: estimatedCost,
          p_max_requests_per_minute: TTS_MAX_REQUESTS_PER_MINUTE,
          p_max_requests_per_session: TTS_MAX_REQUESTS_PER_SESSION,
        },
      );
    if (reservationError) throw reservationError;
    const reservation = Array.isArray(reservationRows)
      ? reservationRows[0]
      : reservationRows;
    if (!reservation?.allowed) {
      const reason = reservation?.reason ?? "reservation_failed";
      const status = reason === "inactive_session"
        ? 404
        : reason === "duplicate_request" || reason === "request_id_conflict"
        ? 409
        : 429;
      return jsonResponse(
        {
          error: reason === "daily_budget_exhausted"
            ? "Daily coach credit is used up."
            : reason === "duplicate_request"
            ? "TTS request was already handled."
            : reason === "request_id_conflict"
            ? "request_id was already used for different text."
            : reason === "inactive_session"
            ? "Active coach session not found."
            : "TTS request limit reached.",
          code: reason,
          request_status: reservation?.request_status ?? undefined,
          daily_usage: {
            spent_usd: Number(reservation?.spent_usd ?? 0),
            budget_usd: Number(reservation?.budget_usd ?? 0.75),
            remaining_usd: Number(reservation?.remaining_usd ?? 0),
          },
        },
        status,
      );
    }
    reserved = true;

    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      await supabase.rpc("finalize_coach_tts_usage", {
        p_user_id: userId,
        p_request_id: requestId,
        p_succeeded: false,
      });
      reserved = false;
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }

    const openaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": userId,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice,
        input: text,
        response_format: "pcm",
      }),
    });

    if (!openaiRes.ok || !openaiRes.body) {
      const detail = (await openaiRes.text()).slice(0, 500);
      console.error(
        `OpenAI audio/speech failed (${openaiRes.status}):`,
        detail,
      );
      await supabase.rpc("finalize_coach_tts_usage", {
        p_user_id: userId,
        p_request_id: requestId,
        p_succeeded: false,
      });
      await supabase
        .from("coach_tts_requests")
        .update({
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          error_code: `openai_${openaiRes.status}`,
        })
        .eq("user_id", userId)
        .eq("request_id", requestId);
      reserved = false;
      return jsonResponse({
        error: `Speech generation failed (${openaiRes.status})`,
      }, 502);
    }

    // An accepted Speech request incurs provider usage even if the client
    // disconnects during transfer, so finalize before handing off the stream.
    const { error: finalizeError } = await supabase.rpc(
      "finalize_coach_tts_usage",
      {
        p_user_id: userId,
        p_request_id: requestId,
        p_succeeded: true,
      },
    );
    if (finalizeError) {
      console.error("Could not finalize TTS usage:", finalizeError);
      return jsonResponse({ error: "Could not finalize speech usage" }, 500);
    }
    const { error: telemetryError } = await supabase
      .from("coach_tts_requests")
      .update({
        latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        error_code: null,
      })
      .eq("user_id", userId)
      .eq("request_id", requestId);
    if (telemetryError) {
      console.error("Could not record TTS latency:", telemetryError);
    }
    reserved = false;

    return new Response(openaiRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Access-Control-Expose-Headers":
          "Content-Type, X-Coach-TTS-Model, X-Coach-TTS-Voice, X-Coach-TTS-Request-Id",
        "Cache-Control": "no-store",
        "Content-Type": "audio/pcm",
        "X-Coach-TTS-Model": TTS_MODEL,
        "X-Coach-TTS-Voice": voice,
        "X-Coach-TTS-Request-Id": requestId,
      },
    });
  } catch (err) {
    console.error("coach-tts error:", err);
    if (reserved && userId && requestId) {
      const { error: refundError } = await supabase.rpc(
        "finalize_coach_tts_usage",
        {
          p_user_id: userId,
          p_request_id: requestId,
          p_succeeded: false,
        },
      );
      if (refundError) {
        console.error("Could not refund failed TTS reservation:", refundError);
      }
      await supabase
        .from("coach_tts_requests")
        .update({
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          error_code: "proxy_error",
        })
        .eq("user_id", userId)
        .eq("request_id", requestId);
    }
    return jsonResponse({ error: "Could not generate coach speech" }, 500);
  }
});
