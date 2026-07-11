export type CoachMachineState =
  | "idle"
  | "wake_word_listening"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "follow_up"
  | "disconnecting"
  | "error";

export const COACH_FOLLOW_UP_MS = 25_000;
export const COACH_MAX_SESSION_MS = 3 * 60 * 1000;
export const COACH_MAX_RESPONSES_PER_SESSION = 15;
export const COACH_MIN_SPEECH_MS = 600;
export const COACH_DUPLICATE_SPEECH_MS = 2_000;

export function canStartRealtime(state: CoachMachineState): boolean {
  return state === "wake_word_listening" || state === "error" || state === "idle";
}

export function isRealtimeActive(state: CoachMachineState): boolean {
  return (
    state === "connecting" ||
    state === "listening" ||
    state === "thinking" ||
    state === "speaking" ||
    state === "follow_up"
  );
}

export function isWakeWordAllowed(state: CoachMachineState): boolean {
  return state === "wake_word_listening";
}
