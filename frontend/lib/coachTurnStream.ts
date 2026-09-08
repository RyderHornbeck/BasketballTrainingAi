import { supabase } from "@/lib/supabase";
import {
  consumeCoachTurnNdjsonStream,
  type CoachTurnStreamEvent,
} from "./coachTurnEvents";
export {
  parseCoachTurnStreamEvent,
  type CoachTurnStreamEvent,
} from "./coachTurnEvents";

export interface LocalShotSessionContext {
  exerciseId: string;
  drillName: string | null;
  setNumber: number;
  makes: number;
  attempts: number;
  targetAttempts: number | null;
  remainingAttempts: number | null;
  lastLocalUserTranscript: string | null;
  lastLocalCoachReply: string | null;
}

export async function consumeNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: CoachTurnStreamEvent) => void | Promise<void>
): Promise<void> {
  await consumeCoachTurnNdjsonStream(stream, onEvent);
}

export async function streamCoachTurn(input: {
  dayId: string;
  sessionKey: string;
  turnId: string;
  transcript: string;
  stateVersion: number;
  conversationSummary?: string;
  localShotSessionContext?: LocalShotSessionContext | null;
  speculative?: boolean;
  signal: AbortSignal;
  onEvent: (event: CoachTurnStreamEvent) => void | Promise<void>;
}): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session expired. Sign in again.");
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error("Supabase is not configured.");
  const response = await fetch(`${baseUrl}/functions/v1/coach-turn`, {
    method: "POST",
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      day_id: input.dayId,
      session_key: input.sessionKey,
      turn_id: input.turnId,
      transcript: input.transcript,
      state_version: input.stateVersion,
      conversation_summary: input.conversationSummary,
      local_shot_session_context: input.localShotSessionContext
        ? {
          exercise_id: input.localShotSessionContext.exerciseId,
          drill_name: input.localShotSessionContext.drillName,
          set_number: input.localShotSessionContext.setNumber,
          makes: input.localShotSessionContext.makes,
          attempts: input.localShotSessionContext.attempts,
          target_attempts: input.localShotSessionContext.targetAttempts,
          remaining_attempts: input.localShotSessionContext.remainingAttempts,
          last_local_user_transcript:
            input.localShotSessionContext.lastLocalUserTranscript,
          last_local_coach_reply: input.localShotSessionContext.lastLocalCoachReply,
        }
        : null,
      mode: input.speculative === true ? "speculative_read_only" : "standard",
    }),
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Coach response failed (${response.status}).`);
  }
  await consumeNdjsonStream(response.body, input.onEvent);
}

