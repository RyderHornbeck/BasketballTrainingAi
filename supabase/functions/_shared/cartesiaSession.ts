import {
  isCoachVoicePersonaId,
  type CoachVoicePersonaId,
} from "./coachVoices.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface CoachAgentSessionRequest {
  dayId: string;
  sessionKey: string;
  voicePersona: CoachVoicePersonaId;
  stateVersion: number;
  conversationSummary?: string;
  timer?: {
    running: boolean;
    elapsed_seconds: number;
    duration_seconds?: number | null;
    remaining_seconds?: number | null;
    started_at?: string | null;
  };
}

export type CoachAgentSessionValidation =
  | { ok: true; value: CoachAgentSessionRequest }
  | { ok: false; error: string };

export function validateCoachAgentSessionRequest(
  input: unknown,
): CoachAgentSessionValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" };
  }
  const body = input as Record<string, unknown>;
  if (typeof body.day_id !== "string" || !UUID_PATTERN.test(body.day_id)) {
    return { ok: false, error: "Invalid day_id" };
  }
  if (
    typeof body.session_key !== "string" ||
    body.session_key.length < 16 ||
    body.session_key.length > 128 ||
    !SESSION_KEY_PATTERN.test(body.session_key)
  ) {
    return { ok: false, error: "Invalid session_key" };
  }
  if (body.voice_persona != null && !isCoachVoicePersonaId(body.voice_persona)) {
    return { ok: false, error: "Invalid voice_persona" };
  }
  if (
    body.state_version != null &&
    (
      typeof body.state_version !== "number" ||
      !Number.isSafeInteger(body.state_version) ||
      body.state_version < 0 ||
      body.state_version > 1_000_000
    )
  ) {
    return { ok: false, error: "Invalid state_version" };
  }
  if (
    body.conversation_summary != null &&
    (
      typeof body.conversation_summary !== "string" ||
      body.conversation_summary.length > 2_000
    )
  ) {
    return { ok: false, error: "Invalid conversation_summary" };
  }

  let timer: CoachAgentSessionRequest["timer"];
  if (body.timer != null) {
    if (!body.timer || typeof body.timer !== "object" || Array.isArray(body.timer)) {
      return { ok: false, error: "Invalid timer" };
    }
    const rawTimer = body.timer as Record<string, unknown>;
    if (
      typeof rawTimer.running !== "boolean" ||
      typeof rawTimer.elapsed_seconds !== "number" ||
      !Number.isFinite(rawTimer.elapsed_seconds) ||
      rawTimer.elapsed_seconds < 0 ||
      rawTimer.elapsed_seconds > 86_400 ||
      (
        rawTimer.duration_seconds != null &&
        (
          typeof rawTimer.duration_seconds !== "number" ||
          !Number.isFinite(rawTimer.duration_seconds) ||
          rawTimer.duration_seconds <= 0 ||
          rawTimer.duration_seconds > 86_400
        )
      ) ||
      (
        rawTimer.remaining_seconds != null &&
        (
          typeof rawTimer.remaining_seconds !== "number" ||
          !Number.isFinite(rawTimer.remaining_seconds) ||
          rawTimer.remaining_seconds < 0 ||
          rawTimer.remaining_seconds > 86_400
        )
      ) ||
      (
        rawTimer.started_at != null &&
        (
          typeof rawTimer.started_at !== "string" ||
          !Number.isFinite(Date.parse(rawTimer.started_at))
        )
      )
    ) {
      return { ok: false, error: "Invalid timer" };
    }
    timer = {
      running: rawTimer.running,
      elapsed_seconds: Math.floor(rawTimer.elapsed_seconds),
      duration_seconds:
        typeof rawTimer.duration_seconds === "number"
          ? Math.floor(rawTimer.duration_seconds)
          : null,
      remaining_seconds:
        typeof rawTimer.remaining_seconds === "number"
          ? Math.floor(rawTimer.remaining_seconds)
          : null,
      started_at: rawTimer.started_at as string | null | undefined,
    };
  }

  return {
    ok: true,
    value: {
      dayId: body.day_id,
      sessionKey: body.session_key,
      voicePersona: isCoachVoicePersonaId(body.voice_persona)
        ? body.voice_persona
        : "tyler",
      stateVersion: (body.state_version as number | undefined) ?? 0,
      conversationSummary: typeof body.conversation_summary === "string"
        ? body.conversation_summary.trim()
        : undefined,
      timer,
    },
  };
}

export function parseCompactWorkoutContext(serialized: string): Record<string, unknown> {
  const parsed = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Compact workout context must be an object");
  }
  return parsed as Record<string, unknown>;
}
