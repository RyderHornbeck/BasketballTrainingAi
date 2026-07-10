import {
  ExerciseLog,
  PlanGenerationRequest,
  WorkoutDay,
  WorkoutPlan,
} from "@/types/database";
import {
  OnboardingFormData,
  WorkoutDayWithExercises,
  WorkoutExerciseWithClip,
} from "@/types/plan";
import { supabase } from "./supabase";
import { registerForPushNotificationsAsync } from "./notifications";

/** Saves the onboarding answers for a (just-created) user and flips their profile flag. */
export async function submitOnboardingAnswers(
  userId: string,
  form: OnboardingFormData
): Promise<void> {
  const { error: insertError } = await supabase.from("onboarding_answers").insert({
    user_id: userId,
    overall_skill_level: form.overall_skill_level,
    main_goal: form.main_goal,
    position: form.position,
    strengths: form.strengths,
    weaknesses: form.weaknesses,
    shooting_level: form.shooting_level,
    ball_handling_level: form.ball_handling_level,
    finishing_level: form.finishing_level,
    defense_level: form.defense_level,
    basketball_iq_level: form.basketball_iq_level,
    conditioning_level: form.conditioning_level,
    athleticism_level: form.athleticism_level,
    strength_level: form.strength_level,
    days_per_week: form.days_per_week,
    minutes_per_workout: form.minutes_per_workout,
    has_court_access: form.has_court_access,
    equipment: form.equipment,
    injuries_limitations: form.injuries_limitations,
    preferred_intensity: form.preferred_intensity,
  });
  if (insertError) throw new Error(insertError.message);

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true })
    .eq("id", userId);
  if (profileError) throw new Error(profileError.message);
}

/** Creates a plan_generation_requests row and invokes the generate-plan Edge Function. */
export async function requestPlanGeneration(): Promise<PlanGenerationRequest> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not authenticated");

  // Save a push token before generation starts so the user gets notified
  // even if they leave the app while the plan is building.
  await registerForPushNotificationsAsync(userData.user.id);

  const { data: request, error: insertError } = await supabase
    .from("plan_generation_requests")
    .insert({ user_id: userData.user.id, status: "pending" })
    .select()
    .single();

  if (insertError || !request) {
    throw new Error(insertError?.message ?? "Failed to create generation request");
  }

  const { error: invokeError } = await supabase.functions.invoke("generate-plan", {
    body: { request_id: request.id },
  });

  if (invokeError) {
    // The Edge Function is responsible for marking the request as failed on
    // its own errors, but if invocation itself failed (network, cold start,
    // etc.) make sure the UI doesn't spin forever.
    await supabase
      .from("plan_generation_requests")
      .update({ status: "failed", error_message: invokeError.message })
      .eq("id", request.id);
  }

  return request as PlanGenerationRequest;
}

export async function getLatestGenerationRequest(): Promise<PlanGenerationRequest | null> {
  const { data, error } = await supabase
    .from("plan_generation_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as PlanGenerationRequest) ?? null;
}

export async function getGenerationRequestById(
  id: string
): Promise<PlanGenerationRequest | null> {
  const { data, error } = await supabase
    .from("plan_generation_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as PlanGenerationRequest) ?? null;
}

export async function getActivePlan(): Promise<WorkoutPlan | null> {
  const { data, error } = await supabase
    .from("workout_plans")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as WorkoutPlan) ?? null;
}

export async function getWorkoutDays(planId: string): Promise<WorkoutDay[]> {
  const { data, error } = await supabase
    .from("workout_days")
    .select("*")
    .eq("plan_id", planId)
    .order("day_number", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as WorkoutDay[]) ?? [];
}

export async function getWorkoutDayWithExercises(
  dayId: string
): Promise<WorkoutDayWithExercises | null> {
  const { data: day, error: dayError } = await supabase
    .from("workout_days")
    .select("*")
    .eq("id", dayId)
    .single();

  if (dayError || !day) return null;

  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select("*, video_clip:exercise_video_clips(*)")
    .eq("day_id", dayId)
    .order("order_index", { ascending: true });

  if (exercisesError) throw new Error(exercisesError.message);

  const exerciseIds = (exercises ?? []).map((e) => e.id);
  let logsByExercise: Record<string, ExerciseLog> = {};

  if (exerciseIds.length > 0) {
    const { data: logs, error: logsError } = await supabase
      .from("exercise_logs")
      .select("*")
      .in("exercise_id", exerciseIds);

    if (logsError) throw new Error(logsError.message);
    logsByExercise = Object.fromEntries(
      (logs ?? []).map((l) => [l.exercise_id, l as ExerciseLog])
    );
  }

  const exercisesWithClip: WorkoutExerciseWithClip[] = (exercises ?? []).map((e: any) => ({
    ...e,
    video_clip: e.video_clip ?? null,
    log: logsByExercise[e.id] ?? null,
  }));

  return { ...(day as WorkoutDay), exercises: exercisesWithClip };
}

/** A day is unlocked if it isn't flagged locked, OR its scheduled date has arrived. */
export function isDayUnlocked(day: WorkoutDay): boolean {
  if (!day.locked) return true;
  if (day.scheduled_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (day.scheduled_date <= today) return true;
  }
  return false;
}

export interface ExerciseLogInput {
  exercise_id: string;
  completed: boolean;
  makes?: number | null;
  attempts?: number | null;
  minutes_completed?: number | null;
  difficulty?: number | null;
  notes?: string | null;
}

export async function saveExerciseLog(
  dayId: string,
  log: ExerciseLogInput
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("exercise_logs").upsert(
    {
      exercise_id: log.exercise_id,
      day_id: dayId,
      user_id: userId,
      completed: log.completed,
      makes: log.makes ?? null,
      attempts: log.attempts ?? null,
      minutes_completed: log.minutes_completed ?? null,
      difficulty: log.difficulty ?? null,
      notes: log.notes ?? null,
    },
    { onConflict: "exercise_id" }
  );
  if (error) throw new Error(`Failed to save log: ${error.message}`);
}

/**
 * Persists all exercise logs for a day, creates a workout_day_log, marks the
 * day completed, and unlocks the next day in the plan (if any).
 */
export async function finishWorkoutDay(
  day: WorkoutDay,
  logs: ExerciseLogInput[]
): Promise<void> {
  if (day.completed) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  for (const log of logs) {
    await saveExerciseLog(day.id, log);
  }

  const totalMinutes = logs.reduce((sum, l) => sum + (l.minutes_completed ?? 0), 0);

  const { error: dayLogError } = await supabase.from("workout_day_logs").insert({
    day_id: day.id,
    user_id: userId,
    total_minutes: totalMinutes || day.estimated_minutes || null,
  });
  if (dayLogError) throw new Error(`Failed to create day log: ${dayLogError.message}`);

  const { error: dayUpdateError } = await supabase
    .from("workout_days")
    .update({ completed: true, locked: false })
    .eq("id", day.id);
  if (dayUpdateError) throw new Error(`Failed to mark day completed: ${dayUpdateError.message}`);

  if (day.day_number != null) {
    const { error: unlockError } = await supabase
      .from("workout_days")
      .update({ locked: false })
      .eq("plan_id", day.plan_id)
      .eq("day_number", day.day_number + 1);
    if (unlockError) console.error("Failed to unlock next day:", unlockError.message);
  }
}

/** Marks the current active plan inactive and kicks off a fresh generation request. */
export async function regeneratePlan(): Promise<PlanGenerationRequest> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  await supabase.from("workout_plans").update({ active: false }).eq("user_id", userId).eq("active", true);

  return requestPlanGeneration();
}

export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data?.onboarding_completed;
}
