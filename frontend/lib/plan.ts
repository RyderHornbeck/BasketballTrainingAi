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
  aggregateObservedShots,
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
} from "./exerciseSetLogs";
import { supabase } from "./supabase";

export interface WeeklyWorkoutStats {
  shots: number;
  accuracy: number | null;
  averagePerformance: number | null;
}

export async function getCurrentWorkoutStreak(): Promise<number> {
  const { data: logs, error } = await supabase
    .from("workout_day_logs")
    .select("completed_at, activity_date")
    .order("completed_at", { ascending: false });

  if (error) throw new Error(error.message);
  const completedDays = new Set(
    (logs ?? []).map((log) =>
      log.activity_date ?? new Date(log.completed_at).toISOString().slice(0, 10)
    )
  );
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (!completedDays.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (completedDays.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`)) {
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
        const setLogs = hydrateSetLogs(
          plan,
          decodeExerciseLogMeta(exercise.log.notes),
          exercise.log
        );
        const observed = aggregateObservedShots(setLogs);
        if (!observed) continue;
        makes += observed.makes;
        attempts += observed.attempts;
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
  const { error: insertError } = await supabase.from("onboarding_answers").upsert(
    {
      user_id: userId,
      overall_skill_level: form.overall_skill_level,
      playing_level: form.playing_level,
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
      has_court_access: true,
      equipment: ["Basketball"],
      injuries_limitations: "",
      preferred_intensity: form.preferred_intensity,
    },
    { onConflict: "user_id" }
  );
  if (insertError) throw new Error(insertError.message);

  const { error: profileError } = await supabase.rpc("complete_my_onboarding");
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

async function invokePlanGeneration(requestId: string): Promise<void> {
  const { error: invokeError } = await supabase.functions.invoke("generate-plan", {
    body: { request_id: requestId },
  });

  if (invokeError) {
    // Status is server-controlled. A later retry can safely invoke the same
    // pending request again because generation requests are idempotent.
    console.error("Plan generation invocation failed:", invokeError.message);
  }
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
  if (existing) {
    if (existing.status === "pending") {
      await invokePlanGeneration(existing.id);
    }
    return existing;
  }

  const { data: requestData, error: insertError } = await supabase.rpc(
    "create_my_plan_generation_request",
    {
      p_generation_type: generationType,
      p_target_plan_id: targetPlanId,
      p_block_index: blockIndex,
    }
  );
  const request = Array.isArray(requestData) ? requestData[0] : requestData;

  if (insertError || !request) {
    const racedRequest = await getInFlightGenerationRequest();
    if (racedRequest) return racedRequest;
    throw new Error(insertError?.message ?? "Failed to create generation request");
  }

  await invokePlanGeneration(request.id);

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

export async function getExerciseCatalogItem(id: string): Promise<ExerciseVideoClip | null> {
  const { data, error } = await supabase
    .from("exercise_video_clips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExerciseVideoClip | null) ?? null;
}

export async function addCatalogExerciseToWorkout(
  dayId: string,
  clip: ExerciseVideoClip
): Promise<void> {
  const { error } = await supabase.rpc("add_my_catalog_exercise", {
    p_day_id: dayId,
    p_catalog_exercise_id: clip.id,
  });
  if (error) throw new Error(error.message);
  emitWorkoutUpdated();
}

export async function removeExerciseFromWorkout(
  dayId: string,
  exerciseId: string
): Promise<void> {
  const { error } = await supabase.rpc("remove_my_workout_exercise", {
    p_day_id: dayId,
    p_exercise_id: exerciseId,
  });
  if (error) throw new Error(error.message);
  emitWorkoutUpdated();
}

/** Full adaptive plan length shown in the day selector strip (200 five-day blocks). */
export const PLAN_TOTAL_DAYS = 1_000;

/** Workouts unlock sequentially: complete Day N to open Day N+1 immediately. */
export function isDayUnlocked(day: WorkoutDay, allDays?: readonly WorkoutDay[]): boolean {
  if (allDays && day.day_number != null && day.day_number > 1) {
    const previous = allDays.find(
      (candidate) => candidate.day_number === (day.day_number ?? 1) - 1
    );
    if (previous && !previous.completed) return false;
  }
  return !day.locked;
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
): Promise<ExerciseLog> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data: cursorRows, error: saveError } = await supabase.rpc(
    "save_my_exercise_log_v2",
    {
      p_day_id: dayId,
      p_exercise_id: log.exercise_id,
      p_completed: log.completed,
      p_makes: log.makes ?? null,
      p_attempts: log.attempts ?? null,
      p_minutes_completed: log.minutes_completed ?? null,
      p_difficulty: log.difficulty ?? null,
      p_notes: log.notes ?? null,
    },
  );
  if (saveError) throw new Error(`Failed to save log: ${saveError.message}`);
  const cursor = Array.isArray(cursorRows) ? cursorRows[0] : cursorRows;
  const { data, error } = await supabase
    .from("exercise_logs")
    .select("*")
    .eq("exercise_id", log.exercise_id)
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`Failed to load saved log: ${error.message}`);
  emitWorkoutUpdated("manual", {
    stateVersion:
      cursor && typeof cursor.state_version === "number"
        ? cursor.state_version
        : undefined,
  });
  return data as ExerciseLog;
}

export async function appendExerciseSet(dayId: string, exerciseId: string): Promise<void> {
  const { error } = await supabase.rpc("append_my_exercise_set", {
    p_day_id: dayId,
    p_exercise_id: exerciseId,
  });
  if (error) throw new Error(`Failed to add set: ${error.message}`);
  emitWorkoutUpdated("manual");
}

export async function removeExerciseSet(
  dayId: string,
  exerciseId: string,
  setNumber: number,
): Promise<void> {
  const { error } = await supabase.rpc("remove_my_exercise_set", {
    p_day_id: dayId,
    p_exercise_id: exerciseId,
    p_set_number: setNumber,
  });
  if (error) throw new Error(`Failed to remove set: ${error.message}`);
  emitWorkoutUpdated("manual");
}

/**
 * Persists all exercise logs for a day, creates a workout_day_log, marks the
 * day completed, and unlocks the next day in the plan (if any). A workout can
 * be finished before every drill is complete; in that case it is recorded as
 * partial and only its logged drill data affects analytics.
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

  const { error: finishError } = await supabase.rpc("finish_my_workout_day", {
    p_day_id: day.id,
  });
  if (finishError) throw new Error(`Failed to finish workout: ${finishError.message}`);

  if (day.day_number != null) {
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
