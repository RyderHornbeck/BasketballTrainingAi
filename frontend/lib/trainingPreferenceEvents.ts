export type TrainingPreferenceField =
  | "overall_skill_level"
  | "position"
  | "minutes_per_workout";

export interface TrainingPreferenceUpdate {
  field: TrainingPreferenceField;
  value: string | number;
}

type Listener = (update: TrainingPreferenceUpdate) => void;

const listeners = new Set<Listener>();

export function emitTrainingPreferenceUpdated(update: TrainingPreferenceUpdate): void {
  listeners.forEach((listener) => listener(update));
}

export function onTrainingPreferenceUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
