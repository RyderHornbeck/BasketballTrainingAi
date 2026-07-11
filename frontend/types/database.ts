// Row types mirroring the Supabase Postgres schema defined in
// supabase/migrations/*.sql. Keep these in sync with the SQL migrations.

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "elite";

export type MainGoal =
  | "Make the team"
  | "Improve shooting"
  | "Improve handles"
  | "Improve finishing"
  | "Improve defense"
  | "Get faster"
  | "Improve conditioning"
  | "Become stronger"
  | "Become an all-around better player";

export type Position = "Guard" | "Wing" | "Big" | "Unknown";

export type Equipment =
  | "Basketball"
  | "Cones"
  | "Resistance bands"
  | "Weights"
  | "None";

export type Intensity = "Light" | "Medium" | "Hard" | "Extremely hard";

export type ExerciseCategory =
  | "shooting"
  | "ball_handling"
  | "finishing"
  | "defense"
  | "footwork"
  | "conditioning"
  | "strength"
  | "warmup"
  | "cooldown"
  | "mobility"
  | "basketball_iq";

export type LogType =
  | "checkbox"
  | "makes_attempts"
  | "minutes"
  | "difficulty_rating"
  | "notes";

export type GenerationStatus = "pending" | "generating" | "completed" | "failed";
export type GenerationType = "initial" | "extend";

export interface Profile {
  id: string;
  email: string | null;
  created_at: string;
  onboarding_completed: boolean;
  push_token: string | null;
  theme: "system" | "light" | "dark";
}

export interface OnboardingAnswers {
  id: string;
  user_id: string;
  overall_skill_level: SkillLevel | null;
  main_goal: string | null;
  position: string | null;
  strengths: string | null;
  weaknesses: string | null;
  shooting_level: string | null;
  ball_handling_level: string | null;
  finishing_level: string | null;
  defense_level: string | null;
  basketball_iq_level: string | null;
  conditioning_level: string | null;
  athleticism_level: string | null;
  strength_level: string | null;
  days_per_week: number | null;
  minutes_per_workout: number | null;
  has_court_access: boolean | null;
  equipment: string[] | null;
  injuries_limitations: string | null;
  preferred_intensity: string | null;
  created_at: string;
}

export interface ExerciseVideoClip {
  id: string;
  exercise_name: string;
  category: ExerciseCategory;
  difficulty_level: SkillLevel | null;
  youtube_url: string;
  youtube_video_id: string;
  start_seconds: number;
  end_seconds: number | null;
  description: string | null;
  coaching_notes: string | null;
  skill_levels: string[] | null;
  goals: string[] | null;
  weaknesses: string[] | null;
  equipment: string[] | null;
  positions: string[] | null;
  source_section: string | null;
  source_order: number | null;
  active: boolean;
  created_at: string;
}

export interface PlanGenerationRequest {
  id: string;
  user_id: string;
  status: GenerationStatus;
  generation_type: GenerationType;
  target_plan_id: string | null;
  block_index: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkoutPlan {
  id: string;
  user_id: string;
  title: string | null;
  summary: string | null;
  duration_weeks: number | null;
  days_per_week: number | null;
  created_at: string;
  active: boolean;
}

export interface WorkoutDay {
  id: string;
  plan_id: string;
  user_id: string;
  day_number: number | null;
  block_index: number;
  title: string | null;
  focus: string | null;
  estimated_minutes: number | null;
  coach_notes: string | null;
  locked: boolean;
  completed: boolean;
  scheduled_date: string | null;
  created_at: string;
}

export interface WorkoutExercise {
  id: string;
  day_id: string;
  user_id: string;
  video_clip_id: string | null;
  order_index: number | null;
  name: string | null;
  category: string | null;
  instructions: string | null;
  sets: string | null;
  reps: string | null;
  duration: string | null;
  target_makes: number | null;
  target_attempts: number | null;
  log_type: LogType | null;
  created_at: string;
}

export interface ExerciseLog {
  id: string;
  exercise_id: string;
  day_id: string;
  user_id: string;
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutes_completed: number | null;
  difficulty: number | null;
  notes: string | null;
  created_at: string;
}

export interface WorkoutDayLog {
  id: string;
  day_id: string;
  user_id: string;
  completed_at: string;
  total_minutes: number | null;
}
