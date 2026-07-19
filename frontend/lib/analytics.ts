import { OnboardingAnswers } from "@/types/database";
import { decodeExerciseLogMeta } from "./exerciseSetLogs";
import {
  computeSkillProfile,
  DisciplineWorkout,
  RadarSkillKey,
  SkillProfile,
} from "./skillRatings";
import { ShotMapLogEntry } from "./shotMap";
import { supabase } from "./supabase";

export interface CategoryStats {
  category: string;
  label: string;
  makes: number;
  misses: number;
  attempts: number;
  shootingPct: number | null;
  drillsCompleted: number;
  drillsTotal: number;
}

export type AnalyticsPeriod = "weekly" | "monthly" | "alltime";

export interface ShootingBucket {
  label: string;
  makes: number;
  misses: number;
}

export interface CompletionTrendPoint {
  label: string;
  rate: number;
}

export interface HeatmapPoint {
  date: string;
  value: number;
}

export interface AnalyticsSummary {
  totalWorkoutsCompleted: number;
  currentStreak: number;
  totalMinutesTrained: number;
  totalMakes: number;
  totalMisses: number;
  shootingPercentage: number | null;
  completionRate: number;
  strongestSkill: string | null;
  weakestSkill: string | null;
  weeklyProgress: { label: string; minutes: number }[];
  weeklyShooting: { label: string; pct: number | null; makes: number; attempts: number }[];
  weeklyPctTrend: {
    label: string;
    threePointPct: number | null;
    midrangePct: number | null;
    finishingPct: number | null;
  }[];
  categoryStats: CategoryStats[];
  recentWorkouts: {
    id: string;
    title: string | null;
    completedAt: string;
    totalMinutes: number | null;
  }[];
  workoutHeatmap: HeatmapPoint[];
  skillProfile: SkillProfile;
  shootingLogs: { created_at: string; makes: number | null; attempts: number | null }[];
  firstActivityDate: string | null;
  completionTrend: CompletionTrendPoint[];
  shotMapLogs: ShotMapLogEntry[];
}

const CATEGORY_LABELS: Record<string, string> = {
  shooting: "Shooting",
  ball_handling: "Ball Handling",
  finishing: "Finishing",
  defense: "Defense",
  footwork: "Footwork",
  conditioning: "Conditioning",
  strength: "Strength",
  warmup: "Warmup",
  cooldown: "Cooldown",
  mobility: "Mobility",
  basketball_iq: "Discipline",
};

interface CompletedShotTotals {
  makes: number;
  attempts: number;
}

function workoutActivityTimestamp(log: { activity_date?: string | null; completed_at: string }): string {
  return log.activity_date ? `${log.activity_date}T12:00:00` : log.completed_at;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function workoutActivityDate(log: { activity_date?: string | null; completed_at: string }): string {
  return log.activity_date ?? localDateKey(new Date(log.completed_at));
}

/**
 * Match the Shot Map's source of truth: only completed per-set results count.
 * Legacy logs without set metadata retain their recorded aggregate result.
 */
function completedShotTotals(log: any): CompletedShotTotals | null {
  const meta = decodeExerciseLogMeta(log.notes ?? null);
  if (meta.set_logs?.length) {
    const completedSets = meta.set_logs.filter((set) => set.completed);
    if (completedSets.length === 0) return null;
    const totals = completedSets.reduce(
      (totals, set) => {
        const makes = set.makes ?? 0;
        const attempts = set.attempts ?? makes;
        if (attempts <= 0) return totals;
        return {
          makes: totals.makes + makes,
          attempts: totals.attempts + attempts,
        };
      },
      { makes: 0, attempts: 0 }
    );
    return totals.attempts > 0 ? totals : null;
  }

  if (!log.completed && log.makes == null) return null;
  const attempts = log.attempts ?? 0;
  if (attempts <= 0) return null;
  return { makes: log.makes ?? 0, attempts };
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const [dayLogsResult, allDaysResult, exerciseLogsResult, onboardingResult, ratingResult] =
    await Promise.all([
      supabase
        .from("workout_day_logs")
        .select("*")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false }),
      supabase
        .from("workout_days")
        .select("id, completed, plan_id, title")
        .eq("user_id", userId),
      supabase
        .from("exercise_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("onboarding_answers")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("user_skill_rating_snapshots")
        .select(
          "overall_rating, shooting_rating, ball_handling_rating, finishing_rating, defense_rating, conditioning_rating, discipline_rating"
        )
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
  const firstError =
    dayLogsResult.error ??
    allDaysResult.error ??
    exerciseLogsResult.error ??
    onboardingResult.error ??
    ratingResult.error;
  if (firstError) throw new Error(firstError.message);

  const dayLogs = dayLogsResult.data;
  const allDays = allDaysResult.data;
  const exerciseLogs = exerciseLogsResult.data;
  const onboarding = onboardingResult.data;

  const logs = dayLogs ?? [];
  const workoutActivityDates = new Map<string, string>(
    logs
      .filter((log: any) => log.day_id && log.completed_at)
      .map((log: any) => [log.day_id as string, workoutActivityTimestamp(log)])
  );
  const workoutDayIds = (allDays ?? []).map((day: any) => day.id).filter(Boolean);
  const workoutExercisesResult = workoutDayIds.length
    ? await supabase
        .from("workout_exercises")
        .select(
          "id, day_id, category, name, instructions, sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels"
        )
        .in("day_id", workoutDayIds)
    : { data: [], error: null };
  if (workoutExercisesResult.error) throw new Error(workoutExercisesResult.error.message);
  const workoutExercises = workoutExercisesResult.data ?? [];
  const exerciseById = new Map(
    workoutExercises.map((exercise: any) => [String(exercise.id), exercise])
  );
  const analyticsExerciseLogs = (exerciseLogs ?? []).map((log: any) => ({
    ...log,
    workout_exercises: exerciseById.get(String(log.exercise_id)) ?? null,
    activity_at: workoutActivityDates.get(log.day_id as string) ?? log.created_at,
  }));
  const totalWorkoutsCompleted = logs.length;
  const totalMinutesTrained = logs.reduce((sum, l: any) => sum + (l.total_minutes ?? 0), 0);

  const totalDays = allDays?.length ?? 0;
  const completedDays = allDays?.filter((d: any) => d.completed).length ?? 0;
  const completionRate = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;

  const currentStreak = computeStreak(logs.map((l: any) => workoutActivityDate(l)));

  let totalMakes = 0;
  let totalAttempts = 0;
  const categoryMap: Record<
    string,
    { makes: number; attempts: number; completed: number; total: number }
  > = {};

  for (const log of analyticsExerciseLogs) {
    const category = (log as any).workout_exercises?.category ?? "unknown";
    if (!categoryMap[category]) {
      categoryMap[category] = { makes: 0, attempts: 0, completed: 0, total: 0 };
    }
    categoryMap[category].total += 1;
    if (log.completed) categoryMap[category].completed += 1;

    const shotTotals = completedShotTotals(log);
    if (shotTotals) {
      categoryMap[category].makes += shotTotals.makes;
      categoryMap[category].attempts += shotTotals.attempts;
      totalMakes += shotTotals.makes;
      totalAttempts += shotTotals.attempts;
    }
  }

  const totalMisses = Math.max(0, totalAttempts - totalMakes);
  const shootingPercentage =
    totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null;

  const categoryStats: CategoryStats[] = Object.entries(categoryMap)
    .filter(([cat]) => cat !== "unknown" && cat !== "warmup" && cat !== "cooldown")
    .map(([category, stats]) => {
      const makes = stats.makes;
      const attempts = stats.attempts;
      const misses = Math.max(0, attempts - makes);
      return {
        category,
        label: CATEGORY_LABELS[category] ?? category,
        makes,
        misses,
        attempts,
        shootingPct: attempts > 0 ? Math.round((makes / attempts) * 100) : null,
        drillsCompleted: stats.completed,
        drillsTotal: stats.total,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  let strongestSkill: string | null = null;
  let weakestSkill: string | null = null;
  const shootingCategories = categoryStats.filter((c) => c.attempts >= 5 && c.shootingPct != null);
  if (shootingCategories.length > 0) {
    const sorted = [...shootingCategories].sort((a, b) => (b.shootingPct ?? 0) - (a.shootingPct ?? 0));
    strongestSkill = sorted[0].label;
    weakestSkill = sorted[sorted.length - 1].label;
  } else {
    const byCompletion = [...categoryStats]
      .filter((c) => c.drillsTotal >= 2)
      .sort((a, b) => b.drillsCompleted / b.drillsTotal - a.drillsCompleted / a.drillsTotal);
    if (byCompletion.length > 0) {
      strongestSkill = byCompletion[0].label;
      weakestSkill = byCompletion[byCompletion.length - 1].label;
    }
  }

  const weeklyProgress = computeWeeklyProgress(logs);
  const weeklyShooting = computeWeeklyShooting(analyticsExerciseLogs);
  const weeklyPctTrend = computeWeeklyPctTrend(analyticsExerciseLogs);
  const shootingLogs = analyticsExerciseLogs.flatMap((log) => {
    const totals = completedShotTotals(log);
    return totals
      ? [
          {
            // Keep every shooting set from a completed workout in the same
            // day bucket instead of splitting it by when each exercise row
            // was first created.
            created_at:
              workoutActivityDates.get(log.day_id as string) ??
              (log.created_at as string),
            makes: totals.makes,
            attempts: totals.attempts,
          },
        ]
      : [];
  });

  const firstActivityDate =
    shootingLogs.length > 0
      ? shootingLogs.reduce(
          (min, log) => (log.created_at < min ? log.created_at : min),
          shootingLogs[0].created_at
        )
      : (onboarding as { created_at?: string } | null)?.created_at ?? null;
  const completionTrend = computeCompletionTrend(allDays ?? [], logs);
  const workoutHeatmap = computeWorkoutHeatmap(logs);
  const shotMapLogs = analyticsExerciseLogs as ShotMapLogEntry[];

  const dayTitleById = new Map(
    (allDays ?? []).map((day: any) => [String(day.id), day.title ?? "Workout"])
  );
  const recentWorkouts = logs.slice(0, 8).map((l: any) => ({
    id: l.id,
    title: dayTitleById.get(String(l.day_id)) ?? "Workout",
    completedAt: workoutActivityTimestamp(l),
    totalMinutes: l.total_minutes,
  }));
  const completedExerciseIds = new Set(
    analyticsExerciseLogs
      .filter((log: any) => log.completed === true)
      .map((log: any) => String(log.exercise_id))
  );
  const exercisesByDay = new Map<string, { id: string }[]>();
  for (const exercise of workoutExercises ?? []) {
    const dayId = String((exercise as any).day_id);
    const rows = exercisesByDay.get(dayId) ?? [];
    rows.push({ id: String((exercise as any).id) });
    exercisesByDay.set(dayId, rows);
  }
  const disciplineWorkouts: DisciplineWorkout[] = logs.map((workout: any) => {
    const exercises = exercisesByDay.get(String(workout.day_id)) ?? [];
    const completedExercises = exercises.filter((exercise) =>
      completedExerciseIds.has(exercise.id)
    ).length;
    return {
      completedExercises,
      totalExercises: exercises.length,
      timestamp: new Date(workoutActivityTimestamp(workout)).getTime(),
    };
  });

  const calculatedSkillProfile = computeSkillProfile(
    (onboarding as OnboardingAnswers | null) ?? null,
    analyticsExerciseLogs,
    disciplineWorkouts
  );
  const storedOverall = ratingResult.data?.overall_rating;
  const storedSkillRatings: Record<RadarSkillKey, number | null | undefined> = {
    shooting: ratingResult.data?.shooting_rating,
    ball_handling: ratingResult.data?.ball_handling_rating,
    finishing: ratingResult.data?.finishing_rating,
    defense: ratingResult.data?.defense_rating,
    conditioning: ratingResult.data?.conditioning_rating,
    discipline: ratingResult.data?.discipline_rating,
  };
  const skills = calculatedSkillProfile.skills.map((skill) => {
    const storedScore = storedSkillRatings[skill.key];
    return typeof storedScore === "number" ? { ...skill, score: storedScore } : skill;
  });
  const skillProfile: SkillProfile =
    typeof storedOverall === "number"
      ? { ...calculatedSkillProfile, skills, overall: storedOverall }
      : { ...calculatedSkillProfile, skills };

  return {
    totalWorkoutsCompleted,
    currentStreak,
    totalMinutesTrained,
    totalMakes,
    totalMisses,
    shootingPercentage,
    completionRate,
    strongestSkill,
    weakestSkill,
    weeklyProgress,
    weeklyShooting,
    weeklyPctTrend,
    categoryStats,
    recentWorkouts,
    shootingLogs,
    firstActivityDate,
    completionTrend,
    workoutHeatmap,
    shotMapLogs,
    skillProfile,
  };
}

function computeStreak(completedDates: string[]): number {
  if (completedDates.length === 0) return 0;
  const days = new Set(completedDates);
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  while (days.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeWeeklyProgress(logs: any[]): { label: string; minutes: number }[] {
  const now = new Date();
  const buckets: { label: string; minutes: number; start: Date }[] = [];

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(now.getDate() - i * 7 - now.getDay());
    start.setHours(0, 0, 0, 0);
    buckets.push({ label: `W${6 - i}`, minutes: 0, start });
  }

  for (const log of logs) {
    const date = new Date(workoutActivityTimestamp(log));
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (date >= buckets[i].start) {
        buckets[i].minutes += log.total_minutes ?? 0;
        break;
      }
    }
  }

  return buckets.map((b) => ({ label: b.label, minutes: b.minutes }));
}

function computeWeeklyPctTrend(
  exerciseLogs: any[]
): {
  label: string;
  threePointPct: number | null;
  midrangePct: number | null;
  finishingPct: number | null;
}[] {
  const now = new Date();
  const buckets: {
    label: string;
    threePointMakes: number;
    threePointAttempts: number;
    midrangeMakes: number;
    midrangeAttempts: number;
    finishingMakes: number;
    finishingAttempts: number;
    start: Date;
    end: Date;
  }[] = [];

  for (let i = 5; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(now.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    buckets.push({
      label: `W${6 - i}`,
      threePointMakes: 0,
      threePointAttempts: 0,
      midrangeMakes: 0,
      midrangeAttempts: 0,
      finishingMakes: 0,
      finishingAttempts: 0,
      start,
      end,
    });
  }

  for (const log of exerciseLogs) {
    const shotTotals = completedShotTotals(log);
    if (!shotTotals) continue;
    const category = log.workout_exercises?.category ?? "";
    const date = new Date(log.activity_at ?? log.created_at);
    for (const bucket of buckets) {
      if (date >= bucket.start && date <= bucket.end) {
        const { makes, attempts } = shotTotals;
        if (category === "finishing") {
          bucket.finishingMakes += makes;
          bucket.finishingAttempts += attempts;
        } else if (category === "shooting" || attempts > 0) {
          const name = log.workout_exercises?.name ?? "";
          const isThreePoint = /(?:3[\s-]?(?:point|pt)|three[\s-]?point)/i.test(name);
          if (isThreePoint) {
            bucket.threePointMakes += makes;
            bucket.threePointAttempts += attempts;
          } else {
            bucket.midrangeMakes += makes;
            bucket.midrangeAttempts += attempts;
          }
        }
        break;
      }
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    threePointPct:
      b.threePointAttempts > 0
        ? Math.round((b.threePointMakes / b.threePointAttempts) * 100)
        : null,
    midrangePct:
      b.midrangeAttempts > 0
        ? Math.round((b.midrangeMakes / b.midrangeAttempts) * 100)
        : null,
    finishingPct:
      b.finishingAttempts > 0
        ? Math.round((b.finishingMakes / b.finishingAttempts) * 100)
        : null,
  }));
}

function computeWeeklyShooting(
  exerciseLogs: any[]
): { label: string; pct: number | null; makes: number; attempts: number }[] {
  const now = new Date();
  const buckets: {
    label: string;
    makes: number;
    attempts: number;
    start: Date;
    end: Date;
  }[] = [];

  for (let i = 5; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(now.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    buckets.push({ label: `W${6 - i}`, makes: 0, attempts: 0, start, end });
  }

  for (const log of exerciseLogs) {
    const shotTotals = completedShotTotals(log);
    if (!shotTotals) continue;
    const date = new Date(log.activity_at ?? log.created_at);
    for (const bucket of buckets) {
      if (date >= bucket.start && date <= bucket.end) {
        bucket.makes += shotTotals.makes;
        bucket.attempts += shotTotals.attempts;
        break;
      }
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    makes: b.makes,
    attempts: b.attempts,
    pct: b.attempts > 0 ? Math.round((b.makes / b.attempts) * 100) : null,
  }));
}

function toDateKey(date: Date): string {
  return localDateKey(date);
}

function computeCompletionTrend(
  allDays: { id: string; completed: boolean }[],
  dayLogs: any[]
): CompletionTrendPoint[] {
  const totalDays = allDays.length;
  if (totalDays === 0) return [];

  const completedByWeek = new Map<string, number>();
  for (const log of dayLogs) {
    const date = new Date(workoutActivityTimestamp(log));
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const key = toDateKey(weekStart);
    completedByWeek.set(key, (completedByWeek.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const points: CompletionTrendPoint[] = [];
  let cumulativeCompleted = 0;

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - i * 7 - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const key = toDateKey(weekStart);
    cumulativeCompleted += completedByWeek.get(key) ?? 0;
    const rate = Math.round((cumulativeCompleted / totalDays) * 100);
    points.push({
      label: `W${8 - i}`,
      rate: Math.min(rate, 100),
    });
  }

  return points;
}

function computeWorkoutHeatmap(dayLogs: any[]): HeatmapPoint[] {
  const workoutsByDate = new Map<string, number>();
  for (const log of dayLogs) {
    const key = toDateKey(new Date(workoutActivityTimestamp(log)));
    workoutsByDate.set(key, (workoutsByDate.get(key) ?? 0) + 1);
  }
  return Array.from(workoutsByDate.entries()).map(([date, workouts]) => ({
    date,
    value: Math.min(100, workouts * 25),
  }));
}
