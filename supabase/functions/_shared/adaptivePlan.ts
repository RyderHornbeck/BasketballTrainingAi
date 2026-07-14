export const ADAPTIVE_CATEGORIES = [
  "shooting",
  "ball_handling",
  "finishing",
  "defense",
  "footwork",
  "conditioning",
  "strength",
  "basketball_iq",
] as const;

export type AdaptiveCategory = (typeof ADAPTIVE_CATEGORIES)[number];

export interface AdaptiveAnswers {
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
}

export interface PerformanceSample {
  dayNumber: number;
  category: string;
  videoClipId: string | null;
  sets: string | null;
  duration: string | null;
  targetMakes: number | null;
  targetAttempts: number | null;
  logType: string | null;
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutesCompleted: number | null;
  difficulty: number | null;
  prescribedDifficulty?: string | null;
  notes: string | null;
}

export interface CategoryProfile {
  category: AdaptiveCategory;
  baseline: number;
  recent: number | null;
  historical: number | null;
  score: number;
  confidence: number;
  sampleCount: number;
  progression: "advance" | "increase_target" | "hold" | "regress";
  volumeChangePct: number;
  recentPrescription: {
    averageSets: number | null;
    perSetTargetMakes: number | null;
    perSetTargetAttempts: number | null;
    perSetMinutes: number | null;
    difficulty: string | null;
  };
}

export interface AdaptiveProfile {
  categories: CategoryProfile[];
  weaknesses: AdaptiveCategory[];
  strengths: AdaptiveCategory[];
  otherSkills: AdaptiveCategory[];
  recentVideoClipIds: string[];
}

const CATEGORY_TEXT: Record<AdaptiveCategory, RegExp> = {
  shooting: /shoot|shot|three|midrange|free throw/i,
  ball_handling: /handl|dribbl|control|turnover/i,
  finishing: /finish|layup|rim|mikan|floater/i,
  defense: /defen|on.ball|closeout/i,
  footwork: /footwork|feet|pivot|balance|speed|quick/i,
  conditioning: /condition|cardio|stamina|endurance|gas/i,
  strength: /strength|strong|weight|power/i,
  basketball_iq: /discipline|basketball iq|decision|read|vision|awareness/i,
};

const LEVEL_FIELD: Record<AdaptiveCategory, keyof AdaptiveAnswers> = {
  shooting: "shooting_level",
  ball_handling: "ball_handling_level",
  finishing: "finishing_level",
  defense: "defense_level",
  footwork: "athleticism_level",
  conditioning: "conditioning_level",
  strength: "strength_level",
  basketball_iq: "basketball_iq_level",
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function parseSetCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseMinutes(value: string | null): number | null {
  const match = value?.match(/(\d+(?:\.\d+)?)\s*min/i);
  return match ? Number.parseFloat(match[1]) : null;
}

function completedSetRatio(notes: string | null, fallback: boolean): number {
  const prefix = "__hoop_set_logs__:";
  if (!notes?.startsWith(prefix)) return fallback ? 1 : 0;
  try {
    const parsed = JSON.parse(notes.slice(prefix.length));
    const setLogs = Array.isArray(parsed?.set_logs) ? parsed.set_logs : [];
    if (setLogs.length === 0) return fallback ? 1 : 0;
    return setLogs.filter((entry: { completed?: boolean }) => entry.completed).length / setLogs.length;
  } catch {
    return fallback ? 1 : 0;
  }
}

export function scorePerformanceSample(sample: PerformanceSample): number {
  const setRatio = completedSetRatio(sample.notes, sample.completed);
  if (sample.logType === "makes_attempts" || sample.category === "shooting") {
    const setCount = parseSetCount(sample.sets);
    const expectedMakes = (sample.targetMakes ?? 0) * setCount;
    const targetAccuracy =
      sample.targetMakes != null && sample.targetAttempts
        ? sample.targetMakes / sample.targetAttempts
        : null;
    const actualAccuracy = sample.attempts ? (sample.makes ?? 0) / sample.attempts : null;
    const attainment =
      expectedMakes > 0 ? clamp(((sample.makes ?? 0) / expectedMakes) * 100) : setRatio * 100;
    const accuracy =
      targetAccuracy && actualAccuracy != null
        ? clamp((actualAccuracy / targetAccuracy) * 100)
        : attainment;
    return Math.round(0.55 * attainment + 0.25 * accuracy + 0.2 * setRatio * 100);
  }

  const prescribedMinutes = parseMinutes(sample.duration);
  const timeRatio =
    prescribedMinutes && sample.minutesCompleted != null
      ? clamp((sample.minutesCompleted / (prescribedMinutes * parseSetCount(sample.sets))) * 100)
      : setRatio * 100;
  const comfort =
    sample.difficulty != null ? clamp(100 - (sample.difficulty - 1) * 18) : setRatio * 100;
  return Math.round(0.7 * setRatio * 100 + 0.2 * timeRatio + 0.1 * comfort);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roundedAverage(values: number[], digits = 1): number | null {
  const result = average(values);
  if (result == null) return null;
  const scale = 10 ** digits;
  return Math.round(result * scale) / scale;
}

function mostCommon(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function baselineFor(category: AdaptiveCategory, answers: AdaptiveAnswers): number {
  const raw = Number.parseInt(String(answers[LEVEL_FIELD[category]] ?? "5"), 10);
  let baseline = clamp((Number.isFinite(raw) ? raw : 5) * 10);
  if (CATEGORY_TEXT[category].test(answers.weaknesses ?? "")) baseline -= 12;
  if (CATEGORY_TEXT[category].test(answers.strengths ?? "")) baseline += 12;
  return clamp(baseline);
}

function categoriesMentioned(text: string | null): AdaptiveCategory[] {
  const value = text ?? "";
  return ADAPTIVE_CATEGORIES.filter((category) => CATEGORY_TEXT[category].test(value));
}

export function buildAdaptiveProfile(
  answers: AdaptiveAnswers,
  samples: PerformanceSample[]
): AdaptiveProfile {
  const completedDayNumbers = [...new Set(samples.map((sample) => sample.dayNumber))]
    .sort((a, b) => b - a);
  const recentDays = new Set(completedDayNumbers.slice(0, 5));

  const categories = ADAPTIVE_CATEGORIES.map((category): CategoryProfile => {
    const categorySamples = samples.filter((sample) => sample.category === category);
    const recentScores = categorySamples
      .filter((sample) => recentDays.has(sample.dayNumber))
      .map(scorePerformanceSample);
    const recentSamples = categorySamples.filter((sample) => recentDays.has(sample.dayNumber));
    const olderScores = categorySamples
      .filter((sample) => !recentDays.has(sample.dayNumber))
      .map(scorePerformanceSample);
    const recent = average(recentScores);
    const historical = average(olderScores);
    const observed =
      recent != null && historical != null
        ? recent * 0.7 + historical * 0.3
        : recent ?? historical;
    const confidence = Math.min(1, categorySamples.length / 8);
    const baseline = baselineFor(category, answers);
    const score = Math.round(
      observed == null ? baseline : baseline * (1 - confidence) + observed * confidence
    );
    const progression =
      score >= 85 ? "advance" : score >= 70 ? "increase_target" : score >= 50 ? "hold" : "regress";
    const volumeChangePct = score >= 85 ? 8 : score >= 70 ? 5 : score >= 50 ? 0 : -10;
    return {
      category,
      baseline,
      recent: recent == null ? null : Math.round(recent),
      historical: historical == null ? null : Math.round(historical),
      score,
      confidence: Math.round(confidence * 100) / 100,
      sampleCount: categorySamples.length,
      progression,
      volumeChangePct,
      recentPrescription: {
        averageSets: roundedAverage(recentSamples.map((sample) => parseSetCount(sample.sets))),
        perSetTargetMakes: roundedAverage(
          recentSamples
            .map((sample) => sample.targetMakes)
            .filter((value): value is number => value != null)
        ),
        perSetTargetAttempts: roundedAverage(
          recentSamples
            .map((sample) => sample.targetAttempts)
            .filter((value): value is number => value != null)
        ),
        perSetMinutes: roundedAverage(
          recentSamples
            .map((sample) => parseMinutes(sample.duration))
            .filter((value): value is number => value != null)
        ),
        difficulty: mostCommon(
          recentSamples
            .map((sample) => sample.prescribedDifficulty)
            .filter((value): value is string => Boolean(value))
        ),
      },
    };
  });

  const ranked = [...categories].sort((a, b) => a.score - b.score);
  const weaknesses = categoriesMentioned(answers.weaknesses);
  // Always honor every weakness explicitly selected during onboarding. If
  // fewer than two were selected, fill the remaining focus from measured
  // category scores so the plan still has a useful weakness rotation.
  for (const item of ranked) {
    if (weaknesses.length >= 2) break;
    if (!weaknesses.includes(item.category)) weaknesses.push(item.category);
  }

  const strengths = categoriesMentioned(answers.strengths).filter(
    (category) => !weaknesses.includes(category)
  );
  for (const item of [...ranked].reverse()) {
    if (strengths.length >= 2) break;
    if (!weaknesses.includes(item.category) && !strengths.includes(item.category)) {
      strengths.push(item.category);
    }
  }
  const roleSet = new Set([...weaknesses, ...strengths]);

  return {
    categories,
    weaknesses,
    strengths,
    otherSkills: ADAPTIVE_CATEGORIES.filter((category) => !roleSet.has(category)),
    recentVideoClipIds: [
      ...new Set(
        samples
          .filter((sample) => recentDays.has(sample.dayNumber) && sample.videoClipId)
          .map((sample) => sample.videoClipId as string)
      ),
    ],
  };
}

export interface CompositionRules {
  minutes: number;
  warmups: number;
  totalExercises: number;
  shortSession: boolean;
  flexibleSlots: number;
  weaknessSlots: number;
  strengthSlots: number;
  otherSlots: number;
}

export function buildCompositionRules(minutes: number): CompositionRules {
  if (minutes <= 30) {
    return {
      minutes,
      warmups: 1,
      totalExercises: 5,
      shortSession: true,
      flexibleSlots: 4,
      weaknessSlots: 2,
      strengthSlots: 1,
      otherSlots: 1,
    };
  }

  const warmups = minutes >= 75 ? 2 : 1;
  const totalExercises = minutes <= 45 ? 9 : minutes <= 60 ? 11 : minutes <= 75 ? 13 : 15;
  const flexibleSlots = totalExercises - warmups - 6;
  const weaknessSlots = Math.round(flexibleSlots * 0.5);
  const strengthSlots = Math.round(flexibleSlots * 0.3);
  const otherSlots = Math.max(0, flexibleSlots - weaknessSlots - strengthSlots);
  return {
    minutes,
    warmups,
    totalExercises,
    shortSession: false,
    flexibleSlots,
    weaknessSlots,
    strengthSlots,
    otherSlots,
  };
}
