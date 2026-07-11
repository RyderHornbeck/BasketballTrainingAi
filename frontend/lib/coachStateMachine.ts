export type CoachMachineState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "budget_exhausted"
  | "disconnecting"
  | "error";

export const COACH_MAX_SESSION_MS = 3 * 60 * 1000;
export const COACH_MAX_RESPONSES_PER_SESSION = 15;
export const COACH_MIN_SPEECH_MS = 600;
export const COACH_DUPLICATE_SPEECH_MS = 2_000;

export function isRealtimeActive(state: CoachMachineState): boolean {
  return (
    state === "connecting" ||
    state === "listening" ||
    state === "thinking" ||
    state === "speaking" ||
    state === "muted"
  );
}
