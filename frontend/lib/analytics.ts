import { OnboardingAnswers } from "@/types/database";
import { computeSkillProfile, SkillProfile } from "./skillRatings";
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

export type AnalyticsPeriod = "daily" | "weekly" | "monthly" | "alltime";

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
  weeklyPctTrend: { label: string; shootingPct: number | null; finishingPct: number | null }[];
  categoryStats: CategoryStats[];
  recentWorkouts: {
    id: string;
    title: string | null;
    completedAt: string;
    totalMinutes: number | null;
  }[];
  shootingByPeriod: Record<AnalyticsPeriod, ShootingBucket[]>;
  completionTrend: CompletionTrendPoint[];
  workoutHeatmap: HeatmapPoint[];
  skillProfile: SkillProfile;
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
  basketball_iq: "Basketball IQ",
};

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
          "*, workout_exercises(category, name, sets, duration, target_makes, target_attempts, log_type)"
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

    const makes = log.makes ?? 0;
    const attempts = log.attempts ?? 0;
    if (log.makes != null) categoryMap[category].makes += makes;
    if (log.attempts != null) categoryMap[category].attempts += attempts;
    if (log.makes != null) totalMakes += makes;
    if (log.attempts != null) totalAttempts += attempts;
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
  const shootingByPeriod = computeShootingByPeriod(exerciseLogs ?? []);
  const completionTrend = computeCompletionTrend(allDays ?? [], logs);
  const workoutHeatmap = computeWorkoutHeatmap(logs);

  const recentWorkouts = logs.slice(0, 8).map((l: any) => ({
    id: l.id,
    title: l.workout_days?.title ?? "Workout",
    completedAt: l.completed_at,
    totalMinutes: l.total_minutes,
  }));

  const skillProfile = computeSkillProfile(
    (onboarding as OnboardingAnswers | null) ?? null,
    exerciseLogs ?? []
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
    shootingByPeriod,
    completionTrend,
    workoutHeatmap,
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
): { label: string; shootingPct: number | null; finishingPct: number | null }[] {
  const now = new Date();
  const buckets: {
    label: string;
    shootingMakes: number;
    shootingAttempts: number;
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
      shootingMakes: 0,
      shootingAttempts: 0,
      finishingMakes: 0,
      finishingAttempts: 0,
      start,
      end,
    });
  }

  for (const log of exerciseLogs) {
    if (log.makes == null && log.attempts == null) continue;
    const category = log.workout_exercises?.category ?? "";
    const date = new Date(log.created_at);
    for (const bucket of buckets) {
      if (date >= bucket.start && date <= bucket.end) {
        const makes = log.makes ?? 0;
        const attempts = log.attempts ?? 0;
        if (category === "finishing") {
          bucket.finishingMakes += makes;
          bucket.finishingAttempts += attempts;
        } else if (category === "shooting" || attempts > 0) {
          bucket.shootingMakes += makes;
          bucket.shootingAttempts += attempts;
        }
        break;
      }
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    shootingPct:
      b.shootingAttempts > 0 ? Math.round((b.shootingMakes / b.shootingAttempts) * 100) : null,
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
    if (log.makes == null && log.attempts == null) continue;
    const date = new Date(log.created_at);
    for (const bucket of buckets) {
      if (date >= bucket.start && date <= bucket.end) {
        bucket.makes += log.makes ?? 0;
        bucket.attempts += log.attempts ?? 0;
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

function addShootingToBucket(
  buckets: { label: string; makes: number; misses: number; start: Date; end: Date }[],
  date: Date,
  makes: number,
  attempts: number
) {
  for (const bucket of buckets) {
    if (date >= bucket.start && date <= bucket.end) {
      bucket.makes += makes;
      bucket.misses += Math.max(0, attempts - makes);
      break;
    }
  }
}

function computeShootingByPeriod(exerciseLogs: any[]): Record<AnalyticsPeriod, ShootingBucket[]> {
  const now = new Date();
  const shootingLogs = exerciseLogs.filter((log) => log.makes != null || log.attempts != null);

  const dailyBuckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(now);
    start.setDate(now.getDate() - i);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    dailyBuckets.push({
      label: start.toLocaleDateString(undefined, { weekday: "short" }),
      makes: 0,
      misses: 0,
      start,
      end,
    });
  }

  const weeklyBuckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(now.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    weeklyBuckets.push({ label: `W${6 - i}`, makes: 0, misses: 0, start, end });
  }

  const monthlyBuckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    monthlyBuckets.push({
      label: start.toLocaleDateString(undefined, { month: "short" }),
      makes: 0,
      misses: 0,
      start,
      end,
    });
  }

  const allTimeBuckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    allTimeBuckets.push({
      label: start.toLocaleDateString(undefined, { month: "short" }),
      makes: 0,
      misses: 0,
      start,
      end,
    });
  }

  for (const log of shootingLogs) {
    const date = new Date(log.created_at);
    const makes = log.makes ?? 0;
    const attempts = log.attempts ?? 0;
    addShootingToBucket(dailyBuckets, date, makes, attempts);
    addShootingToBucket(weeklyBuckets, date, makes, attempts);
    addShootingToBucket(monthlyBuckets, date, makes, attempts);
    addShootingToBucket(allTimeBuckets, date, makes, attempts);
  }

  const mapBuckets = (buckets: typeof dailyBuckets): ShootingBucket[] =>
    buckets.map((b) => ({ label: b.label, makes: b.makes, misses: b.misses }));

  return {
    daily: mapBuckets(dailyBuckets),
    weekly: mapBuckets(weeklyBuckets),
    monthly: mapBuckets(monthlyBuckets),
    alltime: mapBuckets(allTimeBuckets),
  };
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
