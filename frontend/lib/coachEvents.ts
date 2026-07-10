// Tiny event bus so the voice coach (mounted in the tab layout) can tell
// screens like Days/Analytics to refetch after it writes workout updates.

type Listener = () => void;

const listeners = new Set<Listener>();

export function onWorkoutUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkoutUpdated(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken listener shouldn't take down the others.
    }
  }
}
