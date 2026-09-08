// Tiny event bus so the voice coach (mounted in the tab layout) can tell
// screens like Days/Analytics to refetch after it writes workout updates.

export type WorkoutUpdateSource = "manual" | "external" | "coach" | "coach_progress";
export interface WorkoutUpdateDetails {
  stateVersion?: number;
}
type Listener = (source: WorkoutUpdateSource, details?: WorkoutUpdateDetails) => void;
type CoachLaunchListener = (dayId: string | null, dayTitle: string | null) => void;

const listeners = new Set<Listener>();
const coachLaunchListeners = new Set<CoachLaunchListener>();
let workoutUpdateRevision = 0;

export function onWorkoutUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWorkoutUpdated(
  source: WorkoutUpdateSource = "external",
  details?: WorkoutUpdateDetails,
): void {
  workoutUpdateRevision += 1;
  for (const listener of listeners) {
    try {
      listener(source, details);
    } catch {
      // A broken listener shouldn't take down the others.
    }
  }
}

export function getWorkoutUpdateRevision(): number {
  return workoutUpdateRevision;
}

export function onCoachLaunchRequested(listener: CoachLaunchListener): () => void {
  coachLaunchListeners.add(listener);
  return () => coachLaunchListeners.delete(listener);
}

export function requestCoachLaunch(dayId: string | null, dayTitle: string | null): void {
  coachLaunchListeners.forEach((listener) => listener(dayId, dayTitle));
}
