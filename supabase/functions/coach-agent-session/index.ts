// Authenticated, provider-neutral bootstrap for mobile voice-coach sessions.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CartesiaAuthError,
  CARTESIA_API_VERSION,
  mintCartesiaSpeechToken,
} from "../_shared/cartesiaAuth.ts";
import {
  parseCompactWorkoutContext,
  validateCoachAgentSessionRequest,
} from "../_shared/cartesiaSession.ts";
import {
  getCoachVoicePersonas,
  resolveCoachVoicePersona,
} from "../_shared/coachVoices.ts";
import {
  buildCompactContextSummary,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import { COACH_LIMITS } from "../_shared/coachUsage.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CARTESIA_API_KEY = Deno.env.get("CARTESIA_API_KEY") ?? "";
const SESSION_PROVIDER = "cartesia";
const SESSION_MODEL = "cartesia/sonic-3.5";

interface BootstrapRow {
  session_id: string;
  started_at: string;
  refreshed_at: string;
  expires_at: string;
  state_version: number;
  spent_usd: number | string;
  budget_usd: number | string;
  remaining_usd: number | string;
  allowed: boolean;
  reason: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
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
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;
    if (!CARTESIA_API_KEY) {
      return jsonResponse({ error: "Voice provider is not configured" }, 500);
    }

    const validation = validateCoachAgentSessionRequest(
      await req.json().catch(() => null),
    );
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400);
    }
    const body = validation.value;
    const voice = resolveCoachVoicePersona(body.voicePersona);

    const { data: bootstrapRows, error: bootstrapError } = await supabase.rpc(
      "bootstrap_coach_agent_session",
      {
        p_user_id: userId,
        p_day_id: body.dayId,
        p_session_key: body.sessionKey,
        p_provider: SESSION_PROVIDER,
        p_model: SESSION_MODEL,
        p_voice_persona: voice.id,
        p_state_version: body.stateVersion,
      },
    );
    if (bootstrapError) throw bootstrapError;
    const bootstrap = (
      Array.isArray(bootstrapRows) ? bootstrapRows[0] : bootstrapRows
    ) as BootstrapRow | null;
    if (!bootstrap) {
      throw new Error("Session bootstrap returned no result");
    }
    if (!bootstrap.allowed) {
      if (bootstrap.reason === "workout_day_not_found") {
        return jsonResponse({ error: "Workout day not found" }, 404);
      }
      if (bootstrap.reason === "session_key_conflict") {
        return jsonResponse(
          { error: "Session key is already bound to another workout." },
          409,
        );
      }
      return jsonResponse({
        error: "Daily coach credit is used up.",
        code: "daily_budget_exhausted",
        daily_usage: {
          spent_usd: Number(bootstrap.spent_usd),
          budget_usd: Number(bootstrap.budget_usd),
          remaining_usd: 0,
        },
      }, 429);
    }

    const [context, profileResult, token] = await Promise.all([
      loadWorkoutContext(supabase, userId, body.dayId),
      supabase
        .from("onboarding_answers")
        .select("main_goal")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      mintCartesiaSpeechToken(CARTESIA_API_KEY),
    ]);
    if (!context) {
      return jsonResponse({ error: "Workout day not found" }, 404);
    }
    if (profileResult.error) throw profileResult.error;

    const workoutContext = parseCompactWorkoutContext(
      buildCompactContextSummary(
        context,
        profileResult.data ?? null,
        body.timer,
        body.conversationSummary,
      ),
    );

    return jsonResponse({
      contract_version: 1,
      session: {
        id: bootstrap.session_id,
        key: body.sessionKey,
        day_id: body.dayId,
        provider: SESSION_PROVIDER,
        status: "active",
        started_at: bootstrap.started_at,
        refreshed_at: bootstrap.refreshed_at,
        expires_at: bootstrap.expires_at,
      },
      state: {
        version: Number(bootstrap.state_version),
        client_version: body.stateVersion,
      },
      provider: {
        id: SESSION_PROVIDER,
        api_version: CARTESIA_API_VERSION,
        access_token: token.token,
        token_type: "Bearer",
        expires_at: token.expires_at,
        expires_in: token.expires_in,
        grants: token.grants,
      },
      voice,
      voice_personas: getCoachVoicePersonas(),
      workout_context: workoutContext,
      daily_usage: {
        spent_usd: Number(bootstrap.spent_usd),
        budget_usd: Number(bootstrap.budget_usd),
        remaining_usd: Number(bootstrap.remaining_usd),
      },
      limits: {
        max_daily_cost_usd: COACH_LIMITS.maxDailyCostUsd,
      },
    });
  } catch (error) {
    if (error instanceof CartesiaAuthError) {
      console.error("coach-agent-session provider auth failed", {
        status: error.status,
        request_id: error.requestId,
      });
      return jsonResponse({ error: "Could not authorize voice provider" }, error.status);
    }
    console.error("coach-agent-session error:", error);
    return jsonResponse({ error: "Could not start coach session" }, 500);
  }
});
