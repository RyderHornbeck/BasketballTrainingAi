// Tiny event bus so the voice coach (mounted in the tab layout) can tell
// screens like Days/Analytics to refetch after it writes workout updates.

export type WorkoutUpdateSource = "manual" | "external" | "coach";
type Listener = (source: WorkoutUpdateSource) => void;

const listeners = new Set<Listener>();

export function onWorkoutUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkoutUpdated(source: WorkoutUpdateSource = "external"): void {
  for (const listener of listeners) {
    try {
      listener(source);
    } catch {
      // A broken listener shouldn't take down the others.
    }
  }
}
