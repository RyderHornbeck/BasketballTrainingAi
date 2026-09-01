// Bootstrap only for the opt-in AssemblyAI → Inworld transport. The Cartesia
// bootstrap and its token flow remain in coach-agent-session unchanged.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mintAssemblyStreamingToken,
  mintDeepgramAccessToken,
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
import {
  DEEPGRAM_STREAMING_CONFIG,
  resolveCoachSttAuthorization,
  selectCoachSttProvider,
} from "../_shared/sttProvider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
const DEEGRAM_BOOL = Deno.env.get("DEEGRAM_BOOL");
const INWORLD_API_KEY = Deno.env.get("INWORLD_API_KEY") ?? "";
const INWORLD_WORKSPACE = Deno.env.get("INWORLD_WORKSPACE") ?? "";
const CARTESIA_API_KEY = Deno.env.get("CARTESIA_API_KEY") ?? "";

function inworldVoiceForPersona(
  persona: string,
): "Nate" | "Evan" | "Sarah" | "Zadie" {
  switch (persona) {
    case "devin":
      return "Nate";
    case "tyler":
      return "Evan";
    case "maya":
      return "Sarah";
    case "ava":
      return "Zadie";
    default:
      return "Evan";
  }
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

async function mintSttAuthorization(
  forceAssemblyFallback: boolean,
  reconnectDeepgram: boolean,
) {
  const result = await resolveCoachSttAuthorization({
    flag: DEEGRAM_BOOL,
    forceAssemblyFallback,
    reconnectDeepgram,
    mintAssembly: () => mintAssemblyStreamingToken(ASSEMBLYAI_API_KEY),
    mintDeepgram: () => mintDeepgramAccessToken(DEEPGRAM_API_KEY),
  });
  if (result.fallbackReason) {
    console.warn("coach-assembly-session Deepgram authorization fallback", {
      provider: "deepgram",
      code: result.fallbackReason,
    });
  }
  return result;
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
    const jwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(
      jwt,
    );
    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;
    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }
    const rawBody = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const useSonic = rawBody?.voice_route === "assembly_sonic";
    const forceAssemblyFallback =
      rawBody?.stt_provider_fallback === "assemblyai";
    if (
      !ASSEMBLYAI_API_KEY || (useSonic ? !CARTESIA_API_KEY : !INWORLD_API_KEY)
    ) {
      return jsonResponse({
        error: "AssemblyAI/Inworld voice provider is not configured",
      }, 500);
    }

    const validation = validateCoachAgentSessionRequest(rawBody);
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);
    const body = validation.value;
    const { data: existingSession, error: existingSessionError } =
      await supabase
        .from("coach_sessions")
        .select("provider")
        .eq("user_id", userId)
        .eq("session_key", body.sessionKey)
        .maybeSingle();
    if (existingSessionError) throw existingSessionError;
    const existingStt = existingSession?.provider === "deepgram_inworld"
      ? "deepgram"
      : existingSession?.provider === "assembly_inworld"
      ? "assemblyai"
      : null;
    const requestedStt = forceAssemblyFallback
      ? "assemblyai"
      : existingStt ?? selectCoachSttProvider(DEEGRAM_BOOL);
    const sessionProvider = useSonic
      ? "assembly_sonic"
      : requestedStt === "deepgram"
      ? "deepgram_inworld"
      : "assembly_inworld";
    const { data: bootstrapRows, error: bootstrapError } = await supabase.rpc(
      "bootstrap_coach_agent_session",
      {
        p_user_id: userId,
        p_day_id: body.dayId,
        p_session_key: body.sessionKey,
        p_provider: sessionProvider,
        p_model: useSonic
          ? "assemblyai/universal-3-5-pro + cartesia/sonic-3.5"
          : requestedStt === "deepgram"
          ? "deepgram/nova-3 + inworld/inworld-tts-2"
          : "assemblyai/universal-3-5-pro + inworld/inworld-tts-2",
        p_voice_persona: body.voicePersona,
        p_state_version: body.stateVersion,
      },
    );
    if (bootstrapError) throw bootstrapError;
    const bootstrap =
      (Array.isArray(bootstrapRows) ? bootstrapRows[0] : bootstrapRows) as
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
        mintSttAuthorization(
          forceAssemblyFallback,
          requestedStt === "deepgram",
        ),
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
    const [stt, inworld] = providerTokens;
    const responseProvider = useSonic
      ? "assembly_sonic"
      : stt.selected === "deepgram"
      ? "deepgram_inworld"
      : "assembly_inworld";
    if (responseProvider !== sessionProvider) {
      await supabase
        .from("coach_sessions")
        .update({
          provider: responseProvider,
          model: stt.selected === "deepgram"
            ? "deepgram/nova-3 + inworld/inworld-tts-2"
            : "assemblyai/universal-3-5-pro + inworld/inworld-tts-2",
        })
        .eq("id", bootstrap.session_id)
        .eq("user_id", userId);
    }
    return jsonResponse({
      contract_version: 1,
      session: {
        id: bootstrap.session_id,
        key: body.sessionKey,
        day_id: body.dayId,
        provider: responseProvider,
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
        id: responseProvider,
        stt: {
          selected: stt.selected,
          fallback: stt.fallback,
          config: stt.selected === "deepgram" ? DEEPGRAM_STREAMING_CONFIG : {
            model: "universal-3-5-pro",
            encoding: "pcm_s16le",
            sample_rate: 16_000,
            channels: 1,
          },
        },
        ...(stt.assembly
          ? {
            assembly: {
              access_token: stt.assembly.token,
              expires_in: stt.assembly.expires_in,
              max_session_duration_seconds:
                stt.assembly.max_session_duration_seconds,
            },
          }
          : {}),
        ...(stt.deepgram
          ? {
            deepgram: {
              access_token: stt.deepgram.token,
              expires_in: stt.deepgram.expires_in,
              expires_at: stt.deepgram.expires_at,
            },
          }
          : {}),
        ...(useSonic
          ? {
            sonic: {
              access_token: (inworld as { token: string }).token,
            },
          }
          : {
            inworld: {
              access_token:
                (inworld as { token: string; expires_at: string }).token,
              expires_at:
                (inworld as { token: string; expires_at: string }).expires_at,
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
