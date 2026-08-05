import { supabase } from "@/lib/supabase";
import { consumeNdjsonStream as consumeNdjson } from "./coachTurnNdjson";

export type CoachTurnStreamEvent =
  | {
      type: "turn_started";
      turn_id: string;
      model: string;
      state_version: number;
      state_fingerprint: string;
    }
  | {
      type: "text_delta";
      turn_id: string;
      state_version: number;
      delta: string;
    }
  | {
      type: "tool_result";
      turn_id: string;
      call_id: string;
      name: string;
      state_version: number;
      db_changed: boolean;
      client_action?: unknown;
      workout_context?: string | null;
    }
  | {
      type: "turn_completed";
      turn_id: string;
      state_version: number;
      state_fingerprint: string;
      workout_context?: string | null;
    }
  | { type: "error"; turn_id: string; error: string };

export async function consumeNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: CoachTurnStreamEvent) => void | Promise<void>
): Promise<void> {
  await consumeNdjson<CoachTurnStreamEvent>(stream, onEvent);
}

export async function streamCoachTurn(input: {
  dayId: string;
  sessionKey: string;
  turnId: string;
  transcript: string;
  stateVersion: number;
  conversationSummary?: string;
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
      mode: input.speculative === true ? "speculative_read_only" : "standard",
    }),
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Coach response failed (${response.status}).`);
  }
  await consumeNdjsonStream(response.body, input.onEvent);
}

