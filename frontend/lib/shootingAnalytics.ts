export type ShootingChartPeriod = "weekly" | "monthly" | "alltime";

export interface ShootingLogEntry {
  created_at: string;
  makes: number | null;
  attempts: number | null;
}

export interface ShootingBucket {
  label: string;
  makes: number;
  misses: number;
}

export function roundChartMax(peak: number): number {
  if (peak <= 0) return 50;
  return Math.ceil(peak / 50) * 50;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getWeekRange(weekOffset: number): { start: Date; end: Date; label: string } {
  const currentStart = startOfWeek(new Date());
  const start = new Date(currentStart);
  start.setDate(start.getDate() - weekOffset * 7);
  const end = endOfWeek(start);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

export function getMonthRange(monthOffset: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 0, 23, 59, 59, 999);
  return {
    start,
    end,
    label: start.toLocaleDateString(undefined, { month: "long" }),
  };
}

function aggregateLogs(
  buckets: { label: string; makes: number; misses: number; start: Date; end: Date }[],
  logs: ShootingLogEntry[]
): ShootingBucket[] {
  for (const log of logs) {
    const date = new Date(log.created_at);
    const makes = log.makes ?? 0;
    const attempts = log.attempts ?? 0;
    for (const bucket of buckets) {
      if (date >= bucket.start && date <= bucket.end) {
        bucket.makes += makes;
        bucket.misses += Math.max(0, attempts - makes);
        break;
      }
    }
  }
  return buckets.map(({ label, makes, misses }) => ({ label, makes, misses }));
}

export function buildWeeklyBuckets(
  logs: ShootingLogEntry[],
  weekOffset: number
): ShootingBucket[] {
  const { start } = getWeekRange(weekOffset);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = dayNames.map((label, index) => {
    const dayStart = new Date(start);
    dayStart.setDate(start.getDate() + index);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    return { label, makes: 0, misses: 0, start: dayStart, end: dayEnd };
  });
  return aggregateLogs(buckets, logs);
}

export function buildMonthlyBuckets(
  logs: ShootingLogEntry[],
  monthOffset: number
): ShootingBucket[] {
  const { start, end } = getMonthRange(monthOffset);
  const buckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  let weekNum = 1;
  let cursor = new Date(start);

  while (cursor <= end && weekNum <= 5) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const cappedEnd = weekEnd > end ? end : weekEnd;
    const endOfDay = new Date(cappedEnd);
    endOfDay.setHours(23, 59, 59, 999);
    buckets.push({
      label: `W${weekNum}`,
      makes: 0,
      misses: 0,
      start: weekStart,
      end: endOfDay,
    });
    cursor.setDate(cursor.getDate() + 7);
    weekNum += 1;
  }

  if (buckets.length === 0) {
    buckets.push({ label: "W1", makes: 0, misses: 0, start, end });
  }

  return aggregateLogs(buckets, logs);
}

export function resolveFirstActivityDate(
  logs: ShootingLogEntry[],
  onboardingCreatedAt: string | null | undefined
): Date {
  let first = onboardingCreatedAt ? new Date(onboardingCreatedAt) : new Date();
  for (const log of logs) {
    const d = new Date(log.created_at);
    if (d < first) first = d;
  }
  return new Date(first.getFullYear(), first.getMonth(), 1);
}

export function buildAllTimeBuckets(
  logs: ShootingLogEntry[],
  firstActivity: Date
): ShootingBucket[] {
  const now = new Date();
  const buckets: { label: string; makes: number; misses: number; start: Date; end: Date }[] = [];
  const cursor = new Date(firstActivity.getFullYear(), firstActivity.getMonth(), 1);

  while (cursor <= now) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({
      label: monthStart.toLocaleDateString(undefined, { month: "short" }),
      makes: 0,
      misses: 0,
      start: monthStart,
      end: monthEnd,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (buckets.length === 0) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({
      label: monthStart.toLocaleDateString(undefined, { month: "short" }),
      makes: 0,
      misses: 0,
      start: monthStart,
      end: monthEnd,
    });
  }

  return aggregateLogs(buckets, logs);
}

export function canGoNextWeek(weekOffset: number): boolean {
  return weekOffset > 0;
}

export function canGoNextMonth(monthOffset: number): boolean {
  return monthOffset > 0;
}
