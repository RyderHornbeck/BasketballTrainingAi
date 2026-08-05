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

export async function consumeCoachTurnNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: CoachTurnStreamEvent) => void | Promise<void>,
): Promise<void> {
  await consumeNdjson<unknown>(stream, async (value) => {
    await onEvent(parseCoachTurnStreamEvent(value));
  });
}

export function parseCoachTurnStreamEvent(value: unknown): CoachTurnStreamEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid coach turn stream event.");
  }
  const event = value as Record<string, unknown>;
  const type = requiredString(event, "type");
  const turnId = requiredString(event, "turn_id");
  if (type === "error") {
    return { type, turn_id: turnId, error: requiredString(event, "error") };
  }
  const stateVersion = requiredNumber(event, "state_version");
  if (type === "turn_started") {
    return {
      type,
      turn_id: turnId,
      model: requiredString(event, "model"),
      state_version: stateVersion,
      state_fingerprint: requiredString(event, "state_fingerprint"),
    };
  }
  if (type === "text_delta") {
    return {
      type,
      turn_id: turnId,
      state_version: stateVersion,
      delta: requiredString(event, "delta"),
    };
  }
  if (type === "tool_result") {
    return {
      type,
      turn_id: turnId,
      call_id: requiredString(event, "call_id"),
      name: requiredString(event, "name"),
      state_version: stateVersion,
      db_changed: requiredBoolean(event, "db_changed"),
      client_action: event.client_action,
      workout_context: optionalNullableString(event, "workout_context"),
    };
  }
  if (type === "turn_completed") {
    return {
      type,
      turn_id: turnId,
      state_version: stateVersion,
      state_fingerprint: requiredString(event, "state_fingerprint"),
      workout_context: optionalNullableString(event, "workout_context"),
    };
  }
  throw new Error(`Unknown coach turn stream event "${type}".`);
}

function requiredString(event: Record<string, unknown>, key: string): string {
  const value = event[key];
  if (typeof value !== "string") {
    throw new Error(`Invalid coach turn stream ${key}.`);
  }
  return value;
}

function requiredNumber(event: Record<string, unknown>, key: string): number {
  const value = event[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid coach turn stream ${key}.`);
  }
  return value;
}

function requiredBoolean(event: Record<string, unknown>, key: string): boolean {
  const value = event[key];
  if (typeof value !== "boolean") {
    throw new Error(`Invalid coach turn stream ${key}.`);
  }
  return value;
}

function optionalNullableString(
  event: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = event[key];
  if (value === undefined || value === null || typeof value === "string") return value;
  throw new Error(`Invalid coach turn stream ${key}.`);
}
