// Bootstrap only for the opt-in AssemblyAI → Inworld transport. The Cartesia
// bootstrap and its token flow remain in coach-agent-session unchanged.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mintAssemblyStreamingToken,
  mintInworldAccessToken,
  VoiceProviderAuthError,
} from "../_shared/assemblyInworldAuth.ts";
import { mintCartesiaSpeechToken } from "../_shared/cartesiaAuth.ts";
import {
  parseCompactWorkoutContext,
  validateCoachAgentSessionRequest,
} from "../_shared/cartesiaSession.ts";
import {
  buildCompactContextSummary,
  loadWorkoutContext,
} from "../_shared/coachCore.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";
import { COACH_LIMITS } from "../_shared/coachUsage.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const INWORLD_API_KEY = Deno.env.get("INWORLD_API_KEY") ?? "";
const INWORLD_WORKSPACE = Deno.env.get("INWORLD_WORKSPACE") ?? "";
const CARTESIA_API_KEY = Deno.env.get("CARTESIA_API_KEY") ?? "";

function inworldVoiceForPersona(persona: string): "Nate" | "Evan" {
  return persona === "devin" || persona === "ava" ? "Evan" : "Nate";
}

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Missing Authorization header" }, 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;
    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }
    const rawBody = await req.json().catch(() => null) as Record<string, unknown> | null;
    const useSonic = rawBody?.voice_route === "assembly_sonic";
    if (!ASSEMBLYAI_API_KEY || (useSonic ? !CARTESIA_API_KEY : !INWORLD_API_KEY)) {
      return jsonResponse({ error: "AssemblyAI/Inworld voice provider is not configured" }, 500);
    }

    const validation = validateCoachAgentSessionRequest(rawBody);
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);
    const body = validation.value;
    const { data: bootstrapRows, error: bootstrapError } = await supabase.rpc(
      "bootstrap_coach_agent_session",
      {
        p_user_id: userId,
        p_day_id: body.dayId,
        p_session_key: body.sessionKey,
        p_provider: useSonic ? "assembly_sonic" : "assembly_inworld",
        p_model: useSonic
          ? "assemblyai/universal-3-5-pro + cartesia/sonic-3.5"
          : "assemblyai/universal-3-5-pro + inworld/inworld-tts-2",
        p_voice_persona: body.voicePersona,
        p_state_version: body.stateVersion,
      },
    );
    if (bootstrapError) throw bootstrapError;
    const bootstrap = (Array.isArray(bootstrapRows) ? bootstrapRows[0] : bootstrapRows) as
      | BootstrapRow
      | null;
    if (!bootstrap) throw new Error("Session bootstrap returned no result");
    if (!bootstrap.allowed) {
      if (bootstrap.reason === "workout_day_not_found") {
        return jsonResponse({ error: "Workout day not found" }, 404);
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

    const [context, profileResult, providerTokens] = await Promise.all([
      loadWorkoutContext(supabase, userId, body.dayId),
      supabase
        .from("onboarding_answers")
        .select("main_goal")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      Promise.all([
        mintAssemblyStreamingToken(ASSEMBLYAI_API_KEY),
        useSonic
          ? mintCartesiaSpeechToken(CARTESIA_API_KEY)
          : mintInworldAccessToken(INWORLD_API_KEY, INWORLD_WORKSPACE),
      ]),
    ]);
    if (!context) return jsonResponse({ error: "Workout day not found" }, 404);
    if (profileResult.error) throw profileResult.error;
    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      await supabase
        .from("coach_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", bootstrap.session_id)
        .eq("user_id", userId);
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }
    const [assembly, inworld] = providerTokens;
    return jsonResponse({
      contract_version: 1,
      session: {
        id: bootstrap.session_id,
        key: body.sessionKey,
        day_id: body.dayId,
        provider: useSonic ? "assembly_sonic" : "assembly_inworld",
        status: "active",
        started_at: bootstrap.started_at,
        refreshed_at: bootstrap.refreshed_at,
        expires_at: bootstrap.expires_at,
      },
      state: { version: Number(bootstrap.state_version), client_version: body.stateVersion },
      provider: {
        id: useSonic ? "assembly_sonic" : "assembly_inworld",
        assembly: {
          access_token: assembly.token,
          expires_in: assembly.expires_in,
          max_session_duration_seconds: assembly.max_session_duration_seconds,
        },
        ...(useSonic
          ? {
            sonic: {
              access_token: (inworld as { token: string }).token,
            },
          }
          : {
            inworld: {
              access_token: (inworld as { token: string; expires_at: string }).token,
              expires_at: (inworld as { token: string; expires_at: string }).expires_at,
            },
          }),
      },
      voice: {
        provider_voice_id: inworldVoiceForPersona(body.voicePersona),
        model_id: "inworld-tts-2",
      },
      workout_context: parseCompactWorkoutContext(
        buildCompactContextSummary(
          context,
          profileResult.data ?? null,
          body.timer,
          body.conversationSummary,
        ),
      ),
      daily_usage: {
        spent_usd: Number(bootstrap.spent_usd),
        budget_usd: Number(bootstrap.budget_usd),
        remaining_usd: Number(bootstrap.remaining_usd),
      },
      limits: { max_daily_cost_usd: COACH_LIMITS.maxDailyCostUsd },
    });
  } catch (error) {
    if (error instanceof VoiceProviderAuthError) {
      console.error("coach-assembly-session provider authorization failed", {
        provider: error.provider,
        status: error.status,
      });
      return jsonResponse(
        {
          error: `Could not authorize ${error.provider}`,
          detail: error.message,
        },
        error.status,
      );
    }
    console.error("coach-assembly-session error:", error);
    return jsonResponse({ error: "Could not start coach session" }, 500);
  }
});
