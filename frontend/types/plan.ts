// App-level composite types built on top of the raw database rows.

import {
  ExerciseLog,
  ExerciseVideoClip,
  WorkoutDay,
  WorkoutExercise,
} from "./database";

export interface WorkoutExerciseWithClip extends WorkoutExercise {
  video_clip: ExerciseVideoClip | null;
  log: ExerciseLog | null;
}

export interface WorkoutDayWithExercises extends WorkoutDay {
  exercises: WorkoutExerciseWithClip[];
}

export type AppState =
  | "logged_out"
  | "onboarding_incomplete"
  | "no_plan"
  | "plan_generating"
  | "plan_failed"
  | "plan_ready";

export interface OnboardingFormData {
  overall_skill_level: string;
  main_goal: string;
  position: string;
  strengths: string;
  weaknesses: string;
  shooting_level: string;
  ball_handling_level: string;
  finishing_level: string;
  defense_level: string;
  basketball_iq_level: string;
  conditioning_level: string;
  athleticism_level: string;
  strength_level: string;
  days_per_week: number;
  minutes_per_workout: number;
  has_court_access: boolean;
  equipment: string[];
  injuries_limitations: string;
  preferred_intensity: string;
}
