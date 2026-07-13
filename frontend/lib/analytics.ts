import { OnboardingAnswers } from "@/types/database";
import { decodeExerciseLogMeta } from "./exerciseSetLogs";
import { computeSkillProfile, DisciplineWorkout, SkillProfile } from "./skillRatings";
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

  const [{ data: dayLogs }, { data: allDays }, { data: exerciseLogs }, { data: onboarding }] =
    await Promise.all([
      supabase
        .from("workout_day_logs")
        .select("*, workout_days(title)")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false }),
      supabase.from("workout_days").select("id, completed, plan_id").eq("user_id", userId),
      supabase
        .from("exercise_logs")
        .select(
          "*, workout_exercises(category, name, instructions, sets, duration, target_makes, target_attempts, log_type, set_side_labels)"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("onboarding_answers")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const logs = dayLogs ?? [];
  const workoutDayIds = (allDays ?? []).map((day: any) => day.id).filter(Boolean);
  const { data: workoutExercises } = workoutDayIds.length
    ? await supabase
        .from("workout_exercises")
        .select("id, day_id, exercise_logs(completed)")
        .in("day_id", workoutDayIds)
    : { data: [] };
  const totalWorkoutsCompleted = logs.length;
  const totalMinutesTrained = logs.reduce((sum, l: any) => sum + (l.total_minutes ?? 0), 0);

  const totalDays = allDays?.length ?? 0;
  const completedDays = allDays?.filter((d: any) => d.completed).length ?? 0;
  const completionRate = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;

  const currentStreak = computeStreak(logs.map((l: any) => l.completed_at));

  let totalMakes = 0;
  let totalAttempts = 0;
  const categoryMap: Record<
    string,
    { makes: number; attempts: number; completed: number; total: number }
  > = {};

  for (const log of exerciseLogs ?? []) {
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
  const weeklyShooting = computeWeeklyShooting(exerciseLogs ?? []);
  const weeklyPctTrend = computeWeeklyPctTrend(exerciseLogs ?? []);
  const shootingLogs = (exerciseLogs ?? []).flatMap((log) => {
    const totals = completedShotTotals(log);
    return totals
      ? [
          {
            created_at: log.created_at as string,
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
  const shotMapLogs = (exerciseLogs ?? []) as ShotMapLogEntry[];

  const recentWorkouts = logs.slice(0, 8).map((l: any) => ({
    id: l.id,
    title: l.workout_days?.title ?? "Workout",
    completedAt: l.completed_at,
    totalMinutes: l.total_minutes,
  }));
  type NestedExerciseLog = { completed?: boolean } | { completed?: boolean }[] | null;
  const exercisesByDay = new Map<string, Array<{ exercise_logs?: NestedExerciseLog }>>();
  for (const exercise of workoutExercises ?? []) {
    const dayId = String((exercise as any).day_id);
    const rows = exercisesByDay.get(dayId) ?? [];
    rows.push(exercise as { exercise_logs?: NestedExerciseLog });
    exercisesByDay.set(dayId, rows);
  }
  const disciplineWorkouts: DisciplineWorkout[] = logs.map((workout: any) => {
    const exercises = exercisesByDay.get(String(workout.day_id)) ?? [];
    const completedExercises = exercises.filter((exercise) => {
      const nestedLog = exercise.exercise_logs;
      return Array.isArray(nestedLog)
        ? nestedLog.some((log) => log.completed === true)
        : nestedLog?.completed === true;
    }).length;
    return {
      completedExercises,
      totalExercises: exercises.length,
      timestamp: new Date(workout.completed_at).getTime(),
    };
  });

  const skillProfile = computeSkillProfile(
    (onboarding as OnboardingAnswers | null) ?? null,
    exerciseLogs ?? [],
    disciplineWorkouts
  );

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
  const days = new Set(completedDates.map((d) => new Date(d).toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();

  const todayStr = cursor.toISOString().slice(0, 10);
  if (!days.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (days.has(cursor.toISOString().slice(0, 10))) {
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
    const date = new Date(log.completed_at);
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
    const date = new Date(log.created_at);
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
    const date = new Date(log.created_at);
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
  return date.toISOString().slice(0, 10);
}

function computeCompletionTrend(
  allDays: { id: string; completed: boolean }[],
  dayLogs: any[]
): CompletionTrendPoint[] {
  const totalDays = allDays.length;
  if (totalDays === 0) return [];

  const completedByWeek = new Map<string, number>();
  for (const log of dayLogs) {
    const date = new Date(log.completed_at);
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
  const byDate = new Map<string, number>();
  for (const log of dayLogs) {
    const key = toDateKey(new Date(log.completed_at));
    const minutes = log.total_minutes ?? 30;
    byDate.set(key, (byDate.get(key) ?? 0) + minutes);
  }
  return Array.from(byDate.entries()).map(([date, value]) => ({ date, value }));
}
