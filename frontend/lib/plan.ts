import {
  ExerciseLog,
  ExerciseVideoClip,
  PlanGenerationRequest,
  WorkoutDay,
  WorkoutPlan,
} from "@/types/database";
import {
  OnboardingFormData,
  WorkoutDayWithExercises,
  WorkoutExerciseWithClip,
} from "@/types/plan";
import { emitWorkoutUpdated } from "./coachEvents";
import { calculateDayPerformance } from "./dayPerformance";
import {
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
} from "./exerciseSetLogs";
import { supabase } from "./supabase";
import { registerForPushNotificationsAsync } from "./notifications";

export interface WeeklyWorkoutStats {
  shots: number;
  accuracy: number | null;
  averagePerformance: number | null;
}

export async function getCurrentWorkoutStreak(): Promise<number> {
  const { data: logs, error } = await supabase
    .from("workout_day_logs")
    .select("completed_at")
    .order("completed_at", { ascending: false });

  if (error) throw new Error(error.message);
  const completedDays = new Set(
    (logs ?? []).map((log) => new Date(log.completed_at).toISOString().slice(0, 10))
  );
  const cursor = new Date();
  if (!completedDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (completedDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Aggregates logged activity from the current five-workout plan block. */
export async function getWeeklyWorkoutStats(): Promise<WeeklyWorkoutStats> {
  const activePlan = await getActivePlan();
  if (!activePlan) {
    return { shots: 0, accuracy: null, averagePerformance: null };
  }

  const planDays = await getWorkoutDays(activePlan.id);
  const sortedDays = [...planDays].sort(
    (a, b) => (a.day_number ?? 0) - (b.day_number ?? 0)
  );
  const currentDay =
    sortedDays.find((day) => !day.completed && isDayUnlocked(day, sortedDays)) ??
    [...sortedDays].reverse().find((day) => day.completed) ??
    sortedDays[0];
  if (!currentDay) {
    return { shots: 0, accuracy: null, averagePerformance: null };
  }

  const currentBlockIndex = currentDay.block_index ?? 1;
  const blockDays = sortedDays.filter(
    (day) => (day.block_index ?? 1) === currentBlockIndex
  );
  const workouts = (
    await Promise.all(blockDays.map((day) => getWorkoutDayWithExercises(day.id)))
  ).filter((day): day is WorkoutDayWithExercises => day != null);
  let makes = 0;
  let attempts = 0;
  const performances = workouts
    .map((day) => {
      for (const exercise of day.exercises) {
        if (exercise.log_type !== "makes_attempts" || !exercise.log) continue;
        const plan = buildSetPlan(exercise);
        // Weekly shots follow the Shot Map rule: a user must explicitly
        // complete a set before its attempts count toward the weekly total.
        const setLogs = hydrateSetLogs(
          plan,
          decodeExerciseLogMeta(exercise.log.notes),
          exercise.log
        );
        for (const set of setLogs) {
          if (!set.completed) continue;
          makes += set.makes ?? 0;
          attempts += set.attempts ?? plan.perSetAttempts ?? 0;
        }
      }
      return calculateDayPerformance(day.exercises);
    })
    .filter((result) => result.hasData)
    .map((result) => result.score);

  return {
    shots: attempts,
    accuracy: attempts > 0 ? Math.round((makes / attempts) * 100) : null,
    averagePerformance:
      performances.length > 0
        ? Math.round(performances.reduce((sum, score) => sum + score, 0) / performances.length)
        : null,
  };
}

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

interface PlanGenerationOptions {
  generationType?: "initial" | "extend";
  targetPlanId?: string | null;
  blockIndex?: number;
}

async function getInFlightGenerationRequest(): Promise<PlanGenerationRequest | null> {
  const { data, error } = await supabase
    .from("plan_generation_requests")
    .select("*")
    .in("status", ["pending", "generating"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlanGenerationRequest) ?? null;
}

/** Creates or reuses an idempotent five-workout generation request. */
export async function requestPlanGeneration(
  options: PlanGenerationOptions = {}
): Promise<PlanGenerationRequest> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not authenticated");
  const generationType = options.generationType ?? "initial";
  const targetPlanId = generationType === "extend" ? options.targetPlanId ?? null : null;
  const blockIndex = generationType === "extend" ? options.blockIndex ?? 2 : 1;
  if (generationType === "extend" && !targetPlanId) {
    throw new Error("A target plan is required for an extension.");
  }

  const existing = await getInFlightGenerationRequest();
  if (existing) return existing;

  // Save a push token before generation starts so the user gets notified
  // even if they leave the app while the plan is building.
  await registerForPushNotificationsAsync(userData.user.id);

  const { data: request, error: insertError } = await supabase
    .from("plan_generation_requests")
    .insert({
      user_id: userData.user.id,
      status: "pending",
      generation_type: generationType,
      target_plan_id: targetPlanId,
      block_index: blockIndex,
    })
    .select()
    .single();

  if (insertError || !request) {
    const racedRequest = await getInFlightGenerationRequest();
    if (racedRequest) return racedRequest;
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

export async function requestNextBlockGeneration(
  planId: string,
  blockIndex: number
): Promise<PlanGenerationRequest> {
  return requestPlanGeneration({
    generationType: "extend",
    targetPlanId: planId,
    blockIndex,
  });
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

export async function getExerciseCatalog(): Promise<ExerciseVideoClip[]> {
  const { data, error } = await supabase
    .from("exercise_video_clips")
    .select("*")
    .eq("active", true)
    .order("exercise_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ExerciseVideoClip[]) ?? [];
}

function catalogPrescription(clip: ExerciseVideoClip) {
  const searchableText = `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`;
  const durationMatch = searchableText.match(/(\d+)\s*(?:to\s*\d+\s*)?(second|minute)/i);
  const timed = durationMatch != null;
  const durationMinutes = durationMatch
    ? durationMatch[2].toLowerCase().startsWith("second")
      ? Math.max(0.5, Number(durationMatch[1]) / 60)
      : Math.max(0.5, Number(durationMatch[1]))
    : null;
  const shooting = clip.category === "shooting";
  const finishing = clip.category === "finishing";
  return {
    sets: "2",
    reps: null,
    duration: timed ? `${durationMinutes} min` : "3 min",
    target_makes: shooting ? 10 : finishing ? 8 : null,
    target_attempts: shooting ? 20 : finishing ? 15 : null,
    log_type: shooting || finishing ? "makes_attempts" : timed ? "minutes" : "checkbox",
    set_side_labels: clip.requires_both_sides ? ["left side", "right side"] : null,
  };
}

async function refreshWorkoutEstimate(dayId: string): Promise<void> {
  const { data: exercises, error } = await supabase
    .from("workout_exercises")
    .select("sets, duration")
    .eq("day_id", dayId);
  if (error) throw new Error(error.message);
  const activeMinutes = (exercises ?? []).reduce((total, exercise) => {
    const sets = Math.max(1, Number.parseInt(exercise.sets ?? "1", 10) || 1);
    const match = exercise.duration?.match(/(\d+(?:\.\d+)?)\s*min/i);
    return total + (match ? Number.parseFloat(match[1]) : 3) * sets;
  }, 0);
  const estimate = Math.max(
    5,
    Math.round(activeMinutes + 5 + (exercises?.length ?? 0) * 1.5)
  );
  const { error: updateError } = await supabase
    .from("workout_days")
    .update({ estimated_minutes: estimate })
    .eq("id", dayId);
  if (updateError) throw new Error(updateError.message);
}

export async function addCatalogExerciseToWorkout(
  dayId: string,
  clip: ExerciseVideoClip
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");
  const { data: lastExercise } = await supabase
    .from("workout_exercises")
    .select("order_index")
    .eq("day_id", dayId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("workout_exercises").insert({
    day_id: dayId,
    user_id: userId,
    video_clip_id: clip.id,
    order_index: (lastExercise?.order_index ?? 0) + 1,
    name: clip.exercise_name,
    category: clip.category,
    instructions: clip.description ?? clip.coaching_notes,
    ...catalogPrescription(clip),
  });
  if (error) throw new Error(error.message);
  await refreshWorkoutEstimate(dayId);
  emitWorkoutUpdated();
}

export async function removeExerciseFromWorkout(
  dayId: string,
  exerciseId: string
): Promise<void> {
  const { error } = await supabase.from("workout_exercises").delete().eq("id", exerciseId);
  if (error) throw new Error(error.message);
  await refreshWorkoutEstimate(dayId);
  emitWorkoutUpdated();
}

/** Full adaptive plan length shown in the day selector strip. */
export const PLAN_TOTAL_DAYS = 100;

/** A day is unlocked if it isn't flagged locked, OR its scheduled date has arrived. */
export function isDayUnlocked(day: WorkoutDay, allDays?: readonly WorkoutDay[]): boolean {
  if (allDays && day.day_number != null && day.day_number > 1) {
    const previous = allDays.find(
      (candidate) => candidate.day_number === (day.day_number ?? 1) - 1
    );
    if (previous && !previous.completed) return false;
  }
  if (!day.locked) return true;
  if (day.scheduled_date) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
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
  emitWorkoutUpdated();
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

  const { error: dayLogError } = await supabase.from("workout_day_logs").upsert(
    {
      day_id: day.id,
      user_id: userId,
      total_minutes: totalMinutes || day.estimated_minutes || null,
    },
    { onConflict: "day_id" }
  );
  if (dayLogError) throw new Error(`Failed to create day log: ${dayLogError.message}`);

  const { error: dayUpdateError } = await supabase
    .from("workout_days")
    .update({ completed: true, locked: false })
    .eq("id", day.id);
  if (dayUpdateError) throw new Error(`Failed to mark day completed: ${dayUpdateError.message}`);

  if (day.day_number != null) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    const { error: unlockError } = await supabase
      .from("workout_days")
      .update({ locked: true, scheduled_date: tomorrowKey })
      .eq("plan_id", day.plan_id)
      .eq("day_number", day.day_number + 1);
    if (unlockError) console.error("Failed to unlock next day:", unlockError.message);

    const { data: remainingDay, error: remainingError } = await supabase
      .from("workout_days")
      .select("id")
      .eq("plan_id", day.plan_id)
      .eq("completed", false)
      .limit(1)
      .maybeSingle();
    if (!remainingError && !remainingDay) {
      try {
        await requestNextBlockGeneration(day.plan_id, (day.block_index ?? 1) + 1);
      } catch (err) {
        // The completed workout remains saved. usePlan retries an exhausted
        // block on the next refresh, so a transient generation failure never
        // blocks workout completion.
        console.error("Failed to request next workout block:", err);
      }
    }
  }
  emitWorkoutUpdated();
}

/** Builds a fresh adaptive five-workout plan while preserving history. */
export async function regeneratePlan(): Promise<PlanGenerationRequest> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  return requestPlanGeneration({ generationType: "initial" });
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
