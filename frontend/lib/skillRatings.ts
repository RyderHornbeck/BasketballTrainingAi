import { OnboardingAnswers } from "@/types/database";
import {
  buildSetPlan,
  decodeExerciseLogMeta,
  ExerciseSetPlan,
  SetLogEntry,
} from "./exerciseSetLogs";

export const RADAR_SKILLS = [
  { key: "shooting", label: "Shooting", levelField: "shooting_level" as const },
  { key: "ball_handling", label: "Ball Handling", levelField: "ball_handling_level" as const },
  { key: "finishing", label: "Finishing", levelField: "finishing_level" as const },
  { key: "defense", label: "Defense", levelField: "defense_level" as const },
  { key: "conditioning", label: "Conditioning", levelField: "conditioning_level" as const },
  { key: "basketball_iq", label: "Basketball IQ", levelField: "basketball_iq_level" as const },
] as const;

export type RadarSkillKey = (typeof RADAR_SKILLS)[number]["key"];

export interface SkillRating {
  key: RadarSkillKey;
  label: string;
  score: number;
  baseline: number;
  sampleCount: number;
  confidence: number;
}

export interface SkillProfile {
  skills: SkillRating[];
  overall: number;
  workoutsInfluencing: number;
}

const CATEGORY_ALIASES: Record<string, RadarSkillKey | null> = {
  shooting: "shooting",
  ball_handling: "ball_handling",
  finishing: "finishing",
  defense: "defense",
  conditioning: "conditioning",
  basketball_iq: "basketball_iq",
  footwork: null,
  strength: null,
  warmup: null,
  cooldown: null,
  mobility: null,
};

interface PerformanceEvent {
  skill: RadarSkillKey;
  observedScore: number;
  timestamp: number;
}

interface ExerciseLogRow {
  created_at: string;
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutes_completed: number | null;
  difficulty: number | null;
  notes: string | null;
  workout_exercises?: {
    category: string;
    sets: string | null;
    duration: string | null;
    target_makes: number | null;
    target_attempts: number | null;
    log_type: string | null;
  } | null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function parseSetCount(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function baselineForSkill(
  skill: (typeof RADAR_SKILLS)[number],
  answers: OnboardingAnswers | null
): number {
  if (!answers) return 50;
  const raw = Number.parseInt(String(answers[skill.levelField] ?? "5"), 10);
  const selfRating = clamp(Number.isFinite(raw) ? raw : 5, 0, 10);
  // Onboarding establishes only a 20–70 baseline. Logged workout performance
  // can then move the score outside that range as confidence grows.
  return 20 + selfRating * 5;
}

function scoreSetEntry(entry: SetLogEntry, plan: ExerciseSetPlan): number {
  if (plan.logType === "makes_attempts") {
    const targetMakes = plan.perSetMakes ?? 0;
    const targetAttempts = plan.perSetAttempts ?? targetMakes;
    const makes = entry.makes ?? 0;
    const attempts = entry.attempts ?? targetAttempts;
    const attainment =
      targetMakes > 0 ? clamp((makes / targetMakes) * 100) : entry.completed ? 85 : 35;
    const targetAccuracy = targetAttempts > 0 ? targetMakes / targetAttempts : null;
    const actualAccuracy = attempts > 0 ? makes / attempts : null;
    const accuracy =
      targetAccuracy && actualAccuracy != null
        ? clamp((actualAccuracy / targetAccuracy) * 100)
        : attainment;
    const completion = entry.completed ? 100 : clamp(attainment * 0.6);
    return Math.round(0.55 * attainment + 0.35 * accuracy + 0.1 * completion);
  }

  if (plan.logType === "minutes") {
    const minutes = entry.minutes ?? (entry.completed ? plan.perSetMinutes ?? 0 : 0);
    const target = plan.perSetMinutes ?? 1;
    const timeRatio = clamp((minutes / target) * 100);
    return Math.round(entry.completed ? 0.75 * timeRatio + 12.5 : timeRatio * 0.55);
  }

  return entry.completed ? 65 : 42;
}

function scoreExerciseFallback(
  log: ExerciseLogRow,
  plan: ExerciseSetPlan,
  category: string
): number {
  const setCount = parseSetCount(log.workout_exercises?.sets);
  if (plan.logType === "makes_attempts" || category === "shooting" || category === "finishing") {
    const expectedMakes = (plan.perSetMakes ?? 0) * setCount;
    const attainment =
      expectedMakes > 0
        ? clamp(((log.makes ?? 0) / expectedMakes) * 100)
        : log.completed
          ? 85
          : 40;
    const targetAccuracy =
      plan.perSetMakes != null && plan.perSetAttempts
        ? plan.perSetMakes / plan.perSetAttempts
        : null;
    const actualAccuracy = log.attempts ? (log.makes ?? 0) / log.attempts : null;
    const accuracy =
      targetAccuracy && actualAccuracy != null
        ? clamp((actualAccuracy / targetAccuracy) * 100)
        : attainment;
    return Math.round(0.6 * attainment + 0.3 * accuracy + 0.1 * (log.completed ? 100 : 50));
  }

  const prescribedMinutes = plan.perSetMinutes ?? parseMinutes(log.workout_exercises?.duration);
  const timeRatio =
    prescribedMinutes && log.minutes_completed != null
      ? clamp((log.minutes_completed / (prescribedMinutes * setCount)) * 100)
      : log.completed
        ? 85
        : 45;
  const comfort =
    log.difficulty != null ? clamp(100 - (log.difficulty - 1) * 18) : log.completed ? 80 : 50;
  return Math.round(0.725 * (log.completed ? 100 : 55) + 0.25 * timeRatio + 0.025 * comfort);
}

function parseMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/(\d+(?:\.\d+)?)\s*min/i);
  return match ? Number.parseFloat(match[1]) : null;
}

function expandExerciseLogToEvents(log: ExerciseLogRow): PerformanceEvent[] {
  const category = log.workout_exercises?.category ?? "unknown";
  const skill = CATEGORY_ALIASES[category];
  if (!skill) return [];

  const exercise = {
    sets: log.workout_exercises?.sets ?? "1",
    duration: log.workout_exercises?.duration ?? null,
    reps: null,
    target_makes: log.workout_exercises?.target_makes ?? null,
    target_attempts: log.workout_exercises?.target_attempts ?? null,
    log_type: (log.workout_exercises?.log_type ?? "checkbox") as ExerciseSetPlan["logType"],
    set_side_labels: null,
  };
  const plan = buildSetPlan(exercise as any);
  const meta = decodeExerciseLogMeta(log.notes);
  const timestamp = new Date(log.created_at).getTime();
  const events: PerformanceEvent[] = [];

  if (meta.set_logs?.length) {
    for (const entry of meta.set_logs) {
      events.push({
        skill,
        observedScore: scoreSetEntry(entry, plan),
        timestamp,
      });
    }
    return events;
  }

  events.push({
    skill,
    observedScore: scoreExerciseFallback(log, plan, category),
    timestamp,
  });
  return events;
}

function learningAlpha(sampleCount: number): number {
  const base = 0.0275;
  const floor = 0.006;
  return Math.max(floor, base / (1 + sampleCount * 0.14));
}

function applyTrendNudge(
  ratings: Record<RadarSkillKey, number>,
  eventsBySkill: Record<RadarSkillKey, number[]>
): void {
  for (const skill of RADAR_SKILLS) {
    const scores = eventsBySkill[skill.key];
    if (!scores || scores.length < 8) continue;
    const recent = scores.slice(-12);
    const prior = scores.slice(-24, -12);
    if (prior.length < 4) continue;
    const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const priorAvg = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    const delta = recentAvg - priorAvg;
    if (Math.abs(delta) < 4) continue;
    const nudge = clamp(delta * 0.04, -1.25, 1.25);
    ratings[skill.key] = clamp(ratings[skill.key] + nudge);
  }
}

export function computeSkillProfile(
  answers: OnboardingAnswers | null,
  exerciseLogs: ExerciseLogRow[]
): SkillProfile {
  const ratings = Object.fromEntries(
    RADAR_SKILLS.map((skill) => [skill.key, baselineForSkill(skill, answers)])
  ) as Record<RadarSkillKey, number>;
  const baselines = { ...ratings };
  const sampleCounts = Object.fromEntries(
    RADAR_SKILLS.map((skill) => [skill.key, 0])
  ) as Record<RadarSkillKey, number>;
  const observedHistory = Object.fromEntries(
    RADAR_SKILLS.map((skill) => [skill.key, [] as number[]])
  ) as Record<RadarSkillKey, number[]>;

  const events = exerciseLogs
    .flatMap(expandExerciseLogToEvents)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const event of events) {
    const count = sampleCounts[event.skill];
    const alpha = learningAlpha(count);
    const current = ratings[event.skill];
    ratings[event.skill] = clamp(current * (1 - alpha) + event.observedScore * alpha);
    sampleCounts[event.skill] = count + 1;
    observedHistory[event.skill].push(event.observedScore);
  }

  applyTrendNudge(ratings, observedHistory);

  const skills: SkillRating[] = RADAR_SKILLS.map((skill) => {
    const sampleCount = sampleCounts[skill.key];
    const confidence = Math.min(1, sampleCount / 24);
    return {
      key: skill.key,
      label: skill.label,
      score: Math.round(ratings[skill.key]),
      baseline: baselines[skill.key],
      sampleCount,
      confidence: Math.round(confidence * 100) / 100,
    };
  });

  const overall = Math.round(
    skills.reduce((sum, skill) => sum + skill.score, 0) / skills.length
  );

  return {
    skills,
    overall,
    workoutsInfluencing: new Set(exerciseLogs.map((log) => log.created_at.slice(0, 10))).size,
  };
}
