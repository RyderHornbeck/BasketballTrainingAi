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
