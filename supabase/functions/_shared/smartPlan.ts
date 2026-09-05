// Deterministic five-day block generator.
// ----------------------------------------------------------------------------
// Replaces GPT for plan *structure*. Enforces:
//   - Familiarity mix: ~65% familiar drills, ~25% progressions, ~15% new
//   - Never the exact same drill on consecutive sessions
//   - Session 5 repeats baseline (benchmark) drills for measurable progress
//   - No two maximum-intensity sessions back to back
//   - At least one measurable drill per workout
//   - Shooting in every session when a hoop is available
//   - Per-drill adaptation: regress (<40%), repeat (40-70%), progress (>70%)
//   - Very-hard rating (top of scale) cuts that drill's next volume by 15%
//   - Pain mentioned in notes removes drills using the affected movement
//   - Skipped drills push their categories to the front of the next block
// ----------------------------------------------------------------------------

import {
  AdaptiveProfile,
  CompositionRules,
  PerformanceSample,
  scorePerformanceSample,
} from "./adaptivePlan.ts";

export interface PlanClip {
  id: string;
  exercise_name: string;
  category: string;
  difficulty_level: string | null;
  description: string | null;
  coaching_notes: string | null;
  requires_both_sides: boolean;
  positions?: string[] | null;
}

export interface SmartExercise {
  order_index: number;
  video_clip_id: string;
  name: string;
  category: string;
  instructions: string;
  sets: string;
  reps: string | null;
  duration: string;
  target_makes: number | null;
  target_attempts: number | null;
  log_type: "checkbox" | "makes_attempts" | "minutes" | "difficulty_rating" | "notes";
  set_side_labels: string[] | null;
  allocation_role: "warmup" | "core_required" | "weakness" | "strength" | "other";
}

export interface SmartDay {
  day_number: number;
  title: string;
  focus: string;
  estimated_minutes: number;
  coach_notes: string;
  exercises: SmartExercise[];
}

export interface SmartPlan {
  title: string;
  summary: string;
  duration_weeks: number;
  days_per_week: number;
  days: SmartDay[];
}

// ---------------------------------------------------------------------------
// Drill history and adaptation decisions
// ---------------------------------------------------------------------------

export type DifficultyDecision = "regress" | "repeat" | "progress";

export function determineNextDifficulty(
  percentage: number,
  targetMin: number,
  targetMax: number
): DifficultyDecision {
  if (percentage < targetMin) return "regress";
  if (percentage > targetMax) return "progress";
  return "repeat";
}

export interface DrillHistoryEntry {
  videoClipId: string;
  category: string;
  timesPerformed: number;
  lastDayNumber: number;
  successPct: number;
  decision: DifficultyDecision;
  /** 1-5 in-app scale; >=4.5 means "maximum difficulty" -> cut volume 15%. */
  avgDifficultyRating: number | null;
  prescribedDifficulty: string | null;
  logType: string | null;
  measurable: boolean;
}

export interface DrillHistory {
  byClipId: Map<string, DrillHistoryEntry>;
  /** Most-practiced measurable drills — used as session-5 benchmarks. */
  baselineDrillIds: string[];
  /** Categories excluded because the user reported pain in related movements. */
  painExcludedCategories: Set<string>;
  /** Categories of drills the user skipped — prioritized next block. */
  skippedCategories: string[];
  /** Clips used in the most recent completed session (consecutive-repeat rule). */
  lastSessionClipIds: Set<string>;
}

const NOTES_META_PREFIX = "__hoop_set_logs__:";

export function extractUserNotes(notes: string | null): string | null {
  if (!notes) return null;
  if (!notes.startsWith(NOTES_META_PREFIX)) return notes.trim() || null;
  try {
    const parsed = JSON.parse(notes.slice(NOTES_META_PREFIX.length));
    const userNotes = typeof parsed?.user_notes === "string" ? parsed.user_notes.trim() : "";
    return userNotes || null;
  } catch {
    return null;
  }
}

const PAIN_REGEX = /\b(pain|painful|hurt|hurts|hurting|sore|injur\w*|tweak\w*|strain\w*|swollen)\b/i;

const BODY_PART_EXCLUSIONS: Array<[RegExp, string[]]> = [
  [/\b(knee|ankle|foot|feet|shin|calf|calves|hamstring|quad|groin|hip|leg)\b/i, ["conditioning", "footwork", "finishing"]],
  [/\b(shoulder|elbow|wrist|hand|finger|forearm|arm)\b/i, ["shooting", "strength"]],
  [/\b(back|spine|neck|core|ab|abs)\b/i, ["strength", "conditioning"]],
];

export function detectPainExclusions(noteTexts: string[]): Set<string> {
  const excluded = new Set<string>();
  for (const text of noteTexts) {
    if (!PAIN_REGEX.test(text)) continue;
    let matchedBodyPart = false;
    for (const [regex, categories] of BODY_PART_EXCLUSIONS) {
      if (regex.test(text)) {
        matchedBodyPart = true;
        for (const category of categories) excluded.add(category);
      }
    }
    // Pain with no identifiable body part: only pull the highest-load work.
    if (!matchedBodyPart) excluded.add("conditioning");
  }
  return excluded;
}

export function buildDrillHistory(samples: PerformanceSample[]): DrillHistory {
  const grouped = new Map<string, PerformanceSample[]>();
  for (const sample of samples) {
    if (!sample.videoClipId) continue;
    const list = grouped.get(sample.videoClipId) ?? [];
    list.push(sample);
    grouped.set(sample.videoClipId, list);
  }

  const byClipId = new Map<string, DrillHistoryEntry>();
  for (const [clipId, clipSamples] of grouped) {
    const scores = clipSamples.map(scorePerformanceSample);
    const successPct = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const ratings = clipSamples
      .map((sample) => sample.difficulty)
      .filter((value): value is number => value != null);
    const avgDifficultyRating = ratings.length
      ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
      : null;
    const latest = clipSamples.reduce((a, b) => (a.dayNumber >= b.dayNumber ? a : b));
    const logType = latest.logType;
    byClipId.set(clipId, {
      videoClipId: clipId,
      category: latest.category,
      timesPerformed: clipSamples.length,
      lastDayNumber: latest.dayNumber,
      successPct,
      decision: determineNextDifficulty(successPct, 40, 70),
      avgDifficultyRating,
      prescribedDifficulty: latest.prescribedDifficulty ?? null,
      logType,
      measurable: logType === "makes_attempts" || logType === "minutes",
    });
  }

  const baselineDrillIds = [...byClipId.values()]
    .filter((entry) => entry.measurable)
    .sort((a, b) => b.timesPerformed - a.timesPerformed || b.lastDayNumber - a.lastDayNumber)
    .slice(0, 4)
    .map((entry) => entry.videoClipId);

  const noteTexts = samples
    .map((sample) => extractUserNotes(sample.notes))
    .filter((value): value is string => Boolean(value));

  const skippedCategories = [
    ...new Set(
      samples
        .filter((sample) => !sample.completed)
        .map((sample) => sample.category)
        .filter(Boolean)
    ),
  ];

  const lastDayNumber = Math.max(0, ...samples.map((sample) => sample.dayNumber));
  const lastSessionClipIds = new Set(
    samples
      .filter((sample) => sample.dayNumber === lastDayNumber && sample.videoClipId)
      .map((sample) => sample.videoClipId as string)
  );

  return {
    byClipId,
    baselineDrillIds,
    painExcludedCategories: detectPainExclusions(noteTexts),
    skippedCategories,
    lastSessionClipIds,
  };
}

// ---------------------------------------------------------------------------
// Familiarity buckets
// ---------------------------------------------------------------------------

export type FamiliarityBucket = "familiar" | "progressed" | "new";

const DIFFICULTY_TIERS = ["beginner", "intermediate", "advanced", "elite"];

function nextTier(level: string | null): string | null {
  const index = DIFFICULTY_TIERS.indexOf(level ?? "");
  return index >= 0 && index < DIFFICULTY_TIERS.length - 1 ? DIFFICULTY_TIERS[index + 1] : null;
}

function previousTier(level: string | null): string | null {
  const index = DIFFICULTY_TIERS.indexOf(level ?? "");
  return index > 0 ? DIFFICULTY_TIERS[index - 1] : null;
}

export function classifyClip(clip: PlanClip, history: DrillHistory): FamiliarityBucket {
  if (history.byClipId.has(clip.id)) return "familiar";
  for (const entry of history.byClipId.values()) {
    if (
      entry.category === clip.category &&
      entry.decision === "progress" &&
      clip.difficulty_level != null &&
      clip.difficulty_level === nextTier(entry.prescribedDifficulty)
    ) {
      return "progressed";
    }
  }
  return "new";
}

interface MixTracker {
  counts: Record<FamiliarityBucket, number>;
  targets: Record<FamiliarityBucket, number>;
}

function createMixTracker(totalSlots: number, historySize: number): MixTracker {
  // With little or no history everything is new, so shift quotas accordingly.
  const familiarShare = historySize >= 10 ? 0.65 : historySize > 0 ? 0.4 : 0;
  const progressedShare = historySize >= 10 ? 0.25 : historySize > 0 ? 0.2 : 0;
  const familiar = Math.round(totalSlots * familiarShare);
  const progressed = Math.round(totalSlots * progressedShare);
  return {
    counts: { familiar: 0, progressed: 0, new: 0 },
    targets: {
      familiar,
      progressed,
      new: Math.max(0, totalSlots - familiar - progressed),
    },
  };
}

function bucketPreference(tracker: MixTracker): FamiliarityBucket[] {
  // Compare each bucket against its pro-rated quota at this point in the
  // block so the familiar/progressed/new mix is spread across all five days
  // instead of front-loading familiar drills.
  const totalPicked =
    tracker.counts.familiar + tracker.counts.progressed + tracker.counts.new;
  const totalTarget =
    tracker.targets.familiar + tracker.targets.progressed + tracker.targets.new;
  const progress = totalTarget > 0 ? (totalPicked + 1) / totalTarget : 1;
  const deficit = (bucket: FamiliarityBucket) =>
    tracker.targets[bucket] * progress - tracker.counts[bucket];
  return (["familiar", "progressed", "new"] as FamiliarityBucket[]).sort(
    (a, b) => deficit(b) - deficit(a)
  );
}

// ---------------------------------------------------------------------------
// Intensity
// ---------------------------------------------------------------------------

function isHighIntensity(clip: PlanClip): boolean {
  if (clip.category === "conditioning" || clip.category === "strength") return true;
  return clip.difficulty_level === "advanced" || clip.difficulty_level === "elite";
}

/**
 * Per-day cap on high-intensity drills. Alternating caps guarantee two
 * maximum-intensity sessions never land back to back; day 5 stays light
 * because it is the measurable benchmark session.
 */
function highIntensityCap(dayOffset: number, totalExercises: number): number {
  if (dayOffset === 4) return 1;
  const heavy = Math.max(2, Math.ceil(totalExercises * 0.4));
  const light = Math.max(1, Math.floor(totalExercises * 0.2));
  return dayOffset % 2 === 1 ? heavy : light;
}

// ---------------------------------------------------------------------------
// Exercise building
// ---------------------------------------------------------------------------

interface BuildContext {
  startDayNumber: number;
  blockIndex: number;
  randomSeed: string;
  adaptiveProfile: AdaptiveProfile;
  composition: CompositionRules;
  daysPerWeek: number;
  mainGoal: string | null;
  preferredDifficulty: string | null;
  preferredPosition: string | null;
  hasCourtAccess: boolean;
  history: DrillHistory;
}

function categoryProfile(profile: AdaptiveProfile, category: string) {
  return profile.categories.find((item) => item.category === category);
}

function minutesPerSet(composition: CompositionRules, averageSets: number): number {
  const transitionBuffer = 5;
  const available = Math.max(10, composition.minutes - transitionBuffer);
  return Math.max(1, Math.floor(available / Math.max(1, composition.totalExercises * averageSets)));
}

function categoryLogType(category: string): SmartExercise["log_type"] {
  if (category === "shooting" || category === "finishing") return "makes_attempts";
  if (category === "ball_handling" || category === "defense" || category === "conditioning") {
    return "minutes";
  }
  return "checkbox";
}

const MIN_SHOOTING_ATTEMPTS_PER_SET = 20;
const MIN_FINISHING_ATTEMPTS_PER_SET = 15;
const MAX_ATTEMPTS_PER_SET = 60;
const MIN_TARGET_ACCURACY = 0.5;

function defaultTargets(
  category: string,
  cat: ReturnType<typeof categoryProfile>,
  volumeMultiplier: number
): { target_makes: number | null; target_attempts: number | null } {
  if (category === "shooting") {
    const baseMakes = cat?.recentPrescription.perSetTargetMakes ?? 8;
    const baseAttempts = cat?.recentPrescription.perSetTargetAttempts ?? 20;
    const scaledMakes = Math.max(1, Math.round(baseMakes * volumeMultiplier));
    const scaledAttempts = Math.round(baseAttempts * volumeMultiplier);
    const target_attempts = Math.min(
      MAX_ATTEMPTS_PER_SET,
      Math.max(
        MIN_SHOOTING_ATTEMPTS_PER_SET,
        scaledMakes + 1,
        scaledAttempts
      )
    );
    const target_makes = Math.min(
      target_attempts,
      Math.max(scaledMakes, Math.ceil(target_attempts * MIN_TARGET_ACCURACY))
    );
    return { target_makes, target_attempts };
  }
  if (category === "finishing") {
    const scaledMakes = Math.max(3, Math.round(5 * volumeMultiplier));
    const scaledAttempts = Math.round(12 * volumeMultiplier);
    const target_attempts = Math.min(
      MAX_ATTEMPTS_PER_SET,
      Math.max(
        MIN_FINISHING_ATTEMPTS_PER_SET,
        scaledMakes + 1,
        scaledAttempts
      )
    );
    const target_makes = Math.min(
      target_attempts,
      Math.max(scaledMakes, Math.ceil(target_attempts * MIN_TARGET_ACCURACY))
    );
    return { target_makes, target_attempts };
  }
  return { target_makes: null, target_attempts: null };
}

function adjustSetsForBilateral(sets: number, requiresBothSides: boolean): number {
  if (!requiresBothSides) return sets;
  return sets <= 2 ? 2 : 4;
}

function buildSetSideLabels(requiresBothSides: boolean, setCount: number): string[] | null {
  if (!requiresBothSides || setCount <= 0) return null;
  return Array.from({ length: setCount }, (_, index) =>
    index % 2 === 0 ? "Right side" : "Left side"
  );
}

function buildExercise(
  clip: PlanClip,
  role: SmartExercise["allocation_role"],
  context: BuildContext,
  perSetMinutes: number
): SmartExercise {
  const { adaptiveProfile, history } = context;
  const cat = categoryProfile(adaptiveProfile, clip.category);
  const entry = history.byClipId.get(clip.id);

  let sets = Math.min(3, Math.max(1, Math.round(cat?.recentPrescription.averageSets ?? 2)));

  // Deterministic per-drill volume adjustments.
  let volumeMultiplier = 1 + (cat?.volumeChangePct ?? 0) / 100;
  if (entry) {
    if (entry.decision === "regress") volumeMultiplier *= 0.9;
    if (entry.avgDifficultyRating != null && entry.avgDifficultyRating >= 4.5) {
      volumeMultiplier *= 0.85;
    }
  }

  const requiresBothSides = clip.requires_both_sides ?? false;
  if (volumeMultiplier < 1 && sets > 1 && !requiresBothSides) {
    sets = Math.max(1, Math.round(sets * volumeMultiplier));
  }
  if (clip.category === "ball_handling") {
    sets = Math.max(2, sets);
  }
  sets = adjustSetsForBilateral(sets, requiresBothSides);

  const { target_makes, target_attempts } = defaultTargets(
    clip.category,
    cat,
    volumeMultiplier
  );
  const log_type = categoryLogType(clip.category);
  const perSetMinutesForDrill =
    clip.category === "ball_handling"
      ? 1
      : clip.category === "defense" || clip.category === "conditioning"
      ? Math.max(1, Math.min(perSetMinutes, 3))
      : perSetMinutes;

  return {
    order_index: 0,
    video_clip_id: clip.id,
    name: clip.exercise_name,
    category: clip.category,
    instructions: clip.description ?? clip.coaching_notes ?? "Focus on quality reps.",
    sets: String(sets),
    reps: null,
    duration: `${perSetMinutesForDrill} min`,
    target_makes,
    target_attempts,
    log_type,
    set_side_labels: buildSetSideLabels(requiresBothSides, sets),
    allocation_role: role,
  };
}

function parseExerciseMinutes(exercise: SmartExercise): number {
  const match = exercise.duration.match(/(\d+(?:\.\d+)?)\s*min/i);
  const setCount = Math.max(1, Number.parseInt(exercise.sets, 10) || 1);
  return (match ? Number.parseFloat(match[1]) : 3) * setCount;
}

// ---------------------------------------------------------------------------
// Clip selection
// ---------------------------------------------------------------------------

interface DayPickState {
  usedInDay: Set<string>;
  highIntensityCount: number;
  highIntensityLimit: number;
  previousDayClipIds: Set<string>;
}

interface BlockPickState {
  tracker: MixTracker;
  usageCount: Map<string, number>;
}

function eligibleClips(
  pool: PlanClip[],
  categories: string[],
  role: SmartExercise["allocation_role"],
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  relaxed = false
): PlanClip[] {
  const { history } = context;

  let candidates = pool.filter(
    (clip) => categories.includes(clip.category) && !day.usedInDay.has(clip.id)
  );

  // Never repeat the exact same drill on consecutive sessions.
  const nonConsecutive = candidates.filter((clip) => !day.previousDayClipIds.has(clip.id));
  if (nonConsecutive.length) candidates = nonConsecutive;

  // Pain rule: drop excluded categories entirely for flexible work; for
  // required core work keep only the gentlest variants instead of skipping.
  const painSafe = candidates.filter(
    (clip) => !history.painExcludedCategories.has(clip.category)
  );
  if (painSafe.length) {
    candidates = painSafe;
  } else if (role === "core_required" || role === "warmup") {
    const gentle = candidates.filter(
      (clip) => clip.difficulty_level === "beginner" || clip.difficulty_level == null
    );
    if (gentle.length) candidates = gentle;
  } else {
    return [];
  }

  // Intensity cap for this session.
  if (day.highIntensityCount >= day.highIntensityLimit) {
    const calm = candidates.filter((clip) => !isHighIntensity(clip));
    if (calm.length) candidates = calm;
  }

  // Avoid over-reusing the same clip across the block.
  if (!relaxed) {
    const fresh = candidates.filter((clip) => (block.usageCount.get(clip.id) ?? 0) === 0);
    if (fresh.length >= 3) candidates = fresh;
  }

  const preferredDifficulty = context.preferredDifficulty?.trim().toLowerCase() ?? "";
  const preferredPosition = context.preferredPosition?.trim().toLowerCase() ?? "";
  const preferenceRank = (clip: PlanClip) => {
    let rank = 0;
    if (
      preferredDifficulty &&
      clip.difficulty_level?.trim().toLowerCase() === preferredDifficulty
    ) {
      rank -= 2;
    }
    if (
      preferredPosition &&
      preferredPosition !== "unknown" &&
      (clip.positions ?? []).some((position) =>
        position.trim().toLowerCase().includes(preferredPosition)
      )
    ) {
      rank -= 1;
    }
    return rank;
  };

  return [...candidates].sort(
    (a, b) =>
      preferenceRank(a) - preferenceRank(b) ||
      a.category.localeCompare(b.category) ||
      (a.difficulty_level ?? "").localeCompare(b.difficulty_level ?? "") ||
      a.id.localeCompare(b.id)
  );
}

function selectClip(
  pool: PlanClip[],
  categories: string[],
  role: SmartExercise["allocation_role"],
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  cursor: number,
  relaxed = false
): PlanClip | null {
  const candidates = eligibleClips(pool, categories, role, context, day, block, relaxed);
  if (!candidates.length) return null;

  const { history } = context;
  const preference = bucketPreference(block.tracker);

  for (const bucket of preference) {
    const bucketClips = candidates.filter((clip) => classifyClip(clip, history) === bucket);
    if (!bucketClips.length) continue;

    let chosen: PlanClip | null = null;
    if (bucket === "familiar") {
      // Apply the per-drill adaptation decision within familiar drills:
      // regressing drills swap to an easier variant when one exists.
      const withDecision = bucketClips
        .map((clip) => ({ clip, entry: history.byClipId.get(clip.id)! }))
        .sort((a, b) => b.entry.timesPerformed - a.entry.timesPerformed);
      const pick = withDecision[cursor % withDecision.length];
      if (pick.entry.decision === "regress") {
        const easier = pool.find(
          (clip) =>
            clip.category === pick.clip.category &&
            clip.difficulty_level === previousTier(pick.entry.prescribedDifficulty) &&
            !day.usedInDay.has(clip.id) &&
            !day.previousDayClipIds.has(clip.id)
        );
        chosen = easier ?? pick.clip;
      } else {
        chosen = pick.clip;
      }
    } else {
      chosen = bucketClips[cursor % bucketClips.length];
    }

    if (chosen) {
      block.tracker.counts[classifyClip(chosen, history)] += 1;
      return chosen;
    }
  }

  return candidates[cursor % candidates.length];
}

function findCategoryClip(
  pool: PlanClip[],
  category: string,
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  role: SmartExercise["allocation_role"] = "core_required"
): PlanClip | null {
  return (
    selectClip(pool, [category], role, context, day, block, 0, true) ??
    pool.find((clip) => clip.category === category && !day.usedInDay.has(clip.id)) ??
    pool.find((clip) => clip.category === category) ??
    null
  );
}

type CoreShootingFamily = "form" | "midrange" | "three_point" | null;

function normalizedDrillName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function coreShootingFamily(name: string): CoreShootingFamily {
  const normalized = normalizedDrillName(name);
  if (normalized === "form shooting") return "form";
  if (/\b(mid range|midrange)\b/.test(normalized)) return "midrange";
  if (/\b(?:3 (?:point|pt|spot|pointer)|three point)\b|\binto a 3\b/.test(normalized)) {
    return "three_point";
  }
  return null;
}

function isEasyBallHandlingWarmup(name: string): boolean {
  return /^(pound dribble|low pound dribble|right and left pounds|v dribble|half circle pound dribbles)$/.test(
    normalizedDrillName(name)
  );
}

export function isRequiredWorkoutCoreClip(
  clip: Pick<PlanClip, "exercise_name" | "category">,
  hasCourtAccess: boolean
): boolean {
  if (clip.category === "ball_handling") {
    return isEasyBallHandlingWarmup(clip.exercise_name);
  }
  return (
    hasCourtAccess &&
    clip.category === "shooting" &&
    coreShootingFamily(clip.exercise_name) !== null
  );
}

function difficultyRank(difficulty: string | null): number {
  const index = ["beginner", "intermediate", "advanced", "elite"].indexOf(
    difficulty?.toLowerCase() ?? ""
  );
  return index < 0 ? 5 : index;
}

function orderedWorkoutExercises(exercises: SmartExercise[]): SmartExercise[] {
  const categoryOrder: Record<string, number> = {
    ball_handling: 0,
    shooting: 1,
    finishing: 2,
    defense: 3,
    conditioning: 4,
    warmup: 5,
    mobility: 6,
    footwork: 7,
    strength: 8,
    basketball_iq: 9,
  };
  const drillOrder = (exercise: SmartExercise): number => {
    if (exercise.category === "ball_handling") {
      return isEasyBallHandlingWarmup(exercise.name) ? 0 : 1;
    }
    if (exercise.category === "shooting") {
      const family = coreShootingFamily(exercise.name);
      return family === "form"
        ? 0
        : family === "midrange"
          ? 1
          : family === "three_point"
            ? 2
            : 3;
    }
    return 0;
  };
  return [...exercises]
    .sort(
      (a, b) =>
        (categoryOrder[a.category] ?? Number.MAX_SAFE_INTEGER) -
          (categoryOrder[b.category] ?? Number.MAX_SAFE_INTEGER) ||
        drillOrder(a) - drillOrder(b) ||
        a.order_index - b.order_index
    )
    .map((exercise, index) => ({ ...exercise, order_index: index + 1 }));
}

function selectRequiredClip(
  pool: PlanClip[],
  predicate: (clip: PlanClip) => boolean,
  context: BuildContext,
  day: DayPickState,
  key: string,
  allowConsecutive = false
): PlanClip | null {
  let candidates = pool.filter((clip) => predicate(clip) && !day.usedInDay.has(clip.id));
  if (!allowConsecutive) {
    const nonConsecutive = candidates.filter((clip) => !day.previousDayClipIds.has(clip.id));
    if (nonConsecutive.length) candidates = nonConsecutive;
  }
  const preferredDifficulty = context.preferredDifficulty?.toLowerCase() ?? "";
  candidates.sort(
    (a, b) =>
      Number(b.difficulty_level?.toLowerCase() === preferredDifficulty) -
        Number(a.difficulty_level?.toLowerCase() === preferredDifficulty) ||
      difficultyRank(a.difficulty_level) - difficultyRank(b.difficulty_level) ||
      stablePositiveHash(`${context.randomSeed}:${key}:${a.id}`) -
        stablePositiveHash(`${context.randomSeed}:${key}:${b.id}`) ||
      a.id.localeCompare(b.id)
  );
  return candidates[0] ?? null;
}

function replaceWithRequiredClip(
  exercises: SmartExercise[],
  clip: PlanClip,
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  perSetMinutes: number,
  preserve: (exercise: SmartExercise) => boolean
): SmartExercise[] {
  if (exercises.some((exercise) => exercise.video_clip_id === clip.id)) return exercises;
  const sameCategoryIndex = [...exercises]
    .map((exercise, index) => ({ exercise, index }))
    .reverse()
    .find(({ exercise }) => exercise.category === clip.category && !preserve(exercise))?.index;
  const flexibleIndex = [...exercises]
    .map((exercise, index) => ({ exercise, index }))
    .reverse()
    .find(
      ({ exercise }) =>
        exercise.allocation_role !== "core_required" &&
        exercise.allocation_role !== "warmup" &&
        !preserve(exercise)
    )?.index;
  const replaceIndex = sameCategoryIndex ?? flexibleIndex ?? exercises.length - 1;
  if (replaceIndex < 0) return exercises;
  const result = [...exercises];
  day.usedInDay.delete(result[replaceIndex].video_clip_id);
  result[replaceIndex] = buildExercise(clip, "core_required", context, perSetMinutes);
  commitClip(clip, day, block);
  return result;
}

function enforceWorkoutCoreSequence(
  exercises: SmartExercise[],
  pool: PlanClip[],
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  perSetMinutes: number,
  dayNumber: number
): SmartExercise[] {
  let result = [...exercises];
  const easyHandling = selectRequiredClip(
    pool,
    (clip) => clip.category === "ball_handling" && isEasyBallHandlingWarmup(clip.exercise_name),
    context,
    day,
    `${dayNumber}:handling-warmup`
  );
  if (
    easyHandling &&
    !result.some(
      (exercise) =>
        exercise.category === "ball_handling" && isEasyBallHandlingWarmup(exercise.name)
    )
  ) {
    result = replaceWithRequiredClip(
      result,
      easyHandling,
      context,
      day,
      block,
      perSetMinutes,
      (exercise) =>
        exercise.category === "ball_handling" && isEasyBallHandlingWarmup(exercise.name)
    );
  }

  if (context.hasCourtAccess && !context.history.painExcludedCategories.has("shooting")) {
    const formShooting = selectRequiredClip(
      pool,
      (clip) => clip.category === "shooting" && coreShootingFamily(clip.exercise_name) === "form",
      context,
      day,
      `${dayNumber}:form-shooting`,
      true
    );
    if (
      formShooting &&
      !result.some((exercise) => coreShootingFamily(exercise.name) === "form")
    ) {
      result = replaceWithRequiredClip(
        result,
        formShooting,
        context,
        day,
        block,
        perSetMinutes,
        (exercise) => {
          const family = coreShootingFamily(exercise.name);
          return family === "midrange" || family === "three_point";
        }
      );
    }

    const hasSupportingShooting = result.some((exercise) => {
      const family = coreShootingFamily(exercise.name);
      return family === "midrange" || family === "three_point";
    });
    if (!hasSupportingShooting) {
      const preferredFamily: CoreShootingFamily =
        dayNumber % 2 === 0 ? "three_point" : "midrange";
      const supportingShooting =
        selectRequiredClip(
          pool,
          (clip) =>
            clip.category === "shooting" &&
            coreShootingFamily(clip.exercise_name) === preferredFamily,
          context,
          day,
          `${dayNumber}:${preferredFamily}`
        ) ??
        selectRequiredClip(
          pool,
          (clip) => {
            const family = coreShootingFamily(clip.exercise_name);
            return (
              clip.category === "shooting" &&
              (family === "midrange" || family === "three_point")
            );
          },
          context,
          day,
          `${dayNumber}:supporting-shooting`
        );
      if (supportingShooting) {
        result = replaceWithRequiredClip(
          result,
          supportingShooting,
          context,
          day,
          block,
          perSetMinutes,
          (exercise) => coreShootingFamily(exercise.name) === "form"
        );
      }
    }
  }

  return orderedWorkoutExercises(result);
}

function insertCategoryExercise(
  exercises: SmartExercise[],
  clip: PlanClip,
  role: SmartExercise["allocation_role"],
  context: BuildContext,
  perSetMinutes: number
): SmartExercise[] {
  const built = buildExercise(clip, role, context, perSetMinutes);
  const replaceIndex = [...exercises]
    .map((exercise, index) => ({ exercise, index }))
    .reverse()
    .find(
      ({ exercise }) =>
        exercise.allocation_role !== "warmup" && exercise.allocation_role !== "core_required"
    )?.index;

  if (replaceIndex != null) {
    return exercises.map((exercise, index) => (index === replaceIndex ? built : exercise));
  }
  if (exercises.length < context.composition.totalExercises) {
    return [...exercises, built];
  }

  const fallbackIndex = [...exercises]
    .map((exercise, index) => ({ exercise, index }))
    .reverse()
    .find(({ exercise }) => exercise.allocation_role !== "warmup")?.index;
  if (fallbackIndex == null) return exercises;
  return exercises.map((exercise, index) => (index === fallbackIndex ? built : exercise));
}

function injectMissingCoreDrills(
  exercises: SmartExercise[],
  pool: PlanClip[],
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState,
  perSetMinutes: number
): SmartExercise[] {
  const result = [...exercises];
  const requirements = context.hasCourtAccess
    ? [
        { category: "shooting", min: 2 },
        { category: "ball_handling", min: 2 },
        { category: "finishing", min: 2 },
      ]
    : [
        { category: "ball_handling", min: 2 },
        { category: "finishing", min: 2 },
      ];

  for (const { category, min } of requirements) {
    let count = result.filter((exercise) => exercise.category === category).length;
    while (count < min) {
      const clip = findCategoryClip(pool, category, context, day, block, "core_required");
      if (!clip) break;
      commitClip(clip, day, block);
      const built = buildExercise(clip, "core_required", context, perSetMinutes);
      const replaceIndex = [...result]
        .map((exercise, index) => ({ exercise, index }))
        .reverse()
        .find(
          ({ exercise }) =>
            exercise.allocation_role !== "core_required" && exercise.allocation_role !== "warmup"
        )?.index;
      if (replaceIndex != null) {
        result[replaceIndex] = built;
      } else if (result.length < context.composition.totalExercises) {
        result.push(built);
      } else {
        result[result.length - 1] = built;
      }
      count += 1;
    }
  }

  return result.slice(0, context.composition.totalExercises);
}

function commitClip(
  clip: PlanClip,
  day: DayPickState,
  block: BlockPickState
): void {
  day.usedInDay.add(clip.id);
  if (isHighIntensity(clip)) day.highIntensityCount += 1;
  block.usageCount.set(clip.id, (block.usageCount.get(clip.id) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// Day construction
// ---------------------------------------------------------------------------

interface SlotSpec {
  role: SmartExercise["allocation_role"];
  categories: string[];
  count: number;
}

function prioritizedCategories(base: string[], skipped: string[]): string[] {
  const prioritized = skipped.filter((category) => base.includes(category));
  const rest = base.filter((category) => !prioritized.includes(category));
  return [...prioritized, ...rest];
}

function rotateCategories(categories: string[], offset: number): string[] {
  if (categories.length < 2) return categories;
  const start = offset % categories.length;
  return [...categories.slice(start), ...categories.slice(0, start)];
}

function daySlotSpecs(context: BuildContext, dayOffset: number): SlotSpec[] {
  const { composition, adaptiveProfile, history } = context;
  const weaknessCategories = rotateCategories(
    prioritizedCategories(adaptiveProfile.weaknesses, history.skippedCategories),
    dayOffset * Math.max(1, composition.weaknessSlots)
  );
  const otherCategories = prioritizedCategories(
    adaptiveProfile.otherSkills,
    history.skippedCategories
  );

  if (composition.shortSession) {
    return [
      { role: "warmup", categories: ["ball_handling"], count: 1 },
      { role: "weakness", categories: weaknessCategories, count: 2 },
      { role: "strength", categories: adaptiveProfile.strengths, count: 1 },
      { role: "other", categories: otherCategories, count: 1 },
    ];
  }

  return [
    { role: "warmup", categories: ["ball_handling"], count: composition.warmups },
    { role: "core_required", categories: ["shooting"], count: 2 },
    { role: "core_required", categories: ["ball_handling"], count: 2 },
    { role: "core_required", categories: ["finishing"], count: 2 },
    { role: "weakness", categories: weaknessCategories, count: composition.weaknessSlots },
    { role: "strength", categories: adaptiveProfile.strengths, count: composition.strengthSlots },
    { role: "other", categories: otherCategories, count: composition.otherSlots },
  ];
}

function ensureMeasurable(
  exercises: SmartExercise[],
  perSetMinutes: number
): SmartExercise[] {
  const hasMeasurable = exercises.some(
    (exercise) => exercise.log_type === "makes_attempts" || exercise.log_type === "minutes"
  );
  if (hasMeasurable || !exercises.length) return exercises;
  const lastIndex = exercises.length - 1;
  return exercises.map((exercise, index) =>
    index === lastIndex
      ? { ...exercise, log_type: "minutes", duration: `${perSetMinutes} min` }
      : exercise
  );
}

function ensureShooting(
  exercises: SmartExercise[],
  pool: PlanClip[],
  context: BuildContext,
  day: DayPickState,
  block: BlockPickState
): SmartExercise[] {
  if (!context.hasCourtAccess) return exercises;
  if (context.history.painExcludedCategories.has("shooting")) return exercises;

  const shootingRole: SmartExercise["allocation_role"] =
    context.adaptiveProfile.weaknesses.includes("shooting")
      ? "weakness"
      : context.adaptiveProfile.strengths.includes("shooting")
        ? "strength"
        : "other";

  const durationMatch = exercises[0]?.duration?.match(/(\d+)/);
  const perSetMinutes = durationMatch
    ? Number.parseInt(durationMatch[1], 10)
    : minutesPerSet(context.composition, 2);
  let result = [...exercises];
  let shootingCount = result.filter((exercise) => exercise.category === "shooting").length;
  while (shootingCount < 2) {
    const clip = findCategoryClip(pool, "shooting", context, day, block, shootingRole);
    if (!clip) break;
    commitClip(clip, day, block);
    result = insertCategoryExercise(result, clip, shootingRole, context, perSetMinutes);
    shootingCount += 1;
  }
  return result;
}

function buildDay(
  pool: PlanClip[],
  context: BuildContext,
  dayOffset: number,
  block: BlockPickState,
  previousDayClipIds: Set<string>
): SmartDay {
  const { composition, adaptiveProfile, startDayNumber, history } = context;
  const dayNumber = startDayNumber + dayOffset;
  const isBenchmarkDay = dayOffset === 4;
  const averageSets = Math.min(
    3,
    Math.max(
      1,
      Math.round(
        categoryProfile(adaptiveProfile, "shooting")?.recentPrescription.averageSets ?? 2
      )
    )
  );
  const perSetMinutes = minutesPerSet(composition, averageSets);

  const day: DayPickState = {
    usedInDay: new Set(),
    highIntensityCount: 0,
    highIntensityLimit: highIntensityCap(dayOffset, composition.totalExercises),
    previousDayClipIds,
  };

  const picked: Array<{ clip: PlanClip; role: SmartExercise["allocation_role"] }> = [];
  let cursor = dayOffset * 3;

  // Benchmark day: lead with baseline drills the user has practiced most so
  // week-over-week progress is measurable on the same drills.
  if (isBenchmarkDay) {
    for (const baselineId of history.baselineDrillIds) {
      if (previousDayClipIds.has(baselineId)) continue;
      const clip = pool.find((item) => item.id === baselineId);
      if (!clip || day.usedInDay.has(clip.id)) continue;
      if (history.painExcludedCategories.has(clip.category)) continue;
      const role: SmartExercise["allocation_role"] =
        adaptiveProfile.weaknesses.some((category) => category === clip.category)
          ? "weakness"
          : adaptiveProfile.strengths.some((category) => category === clip.category)
            ? "strength"
            : "other";
      picked.push({ clip, role });
      commitClip(clip, day, block);
      block.tracker.counts.familiar += 1;
      if (picked.length >= 2) break;
    }
  }

  const specs = daySlotSpecs(context, dayOffset);
  // Benchmark picks consume flexible slots so the day keeps its normal length.
  let benchmarkDebt = picked.length;
  for (const spec of specs) {
    let remaining = spec.count;
    if (benchmarkDebt > 0 && spec.role !== "warmup" && spec.role !== "core_required") {
      const consumed = Math.min(remaining, benchmarkDebt);
      remaining -= consumed;
      benchmarkDebt -= consumed;
    }
    for (let index = 0; index < remaining; index++) {
      const rotated = [
        ...spec.categories.slice(index % Math.max(1, spec.categories.length)),
        ...spec.categories.slice(0, index % Math.max(1, spec.categories.length)),
      ];
      const clip =
        selectClip(pool, rotated, spec.role, context, day, block, cursor++) ??
        selectClip(pool, spec.categories, spec.role, context, day, block, cursor++) ??
        (spec.role === "core_required"
          ? selectClip(pool, spec.categories, spec.role, context, day, block, cursor++, true)
          : null);
      if (!clip) continue;
      picked.push({ clip, role: spec.role });
      commitClip(clip, day, block);
    }
  }

  // Rotate non-warmup segment order across days so sessions feel different.
  const warmups = picked.filter((item) => item.role === "warmup");
  const rest = picked.filter((item) => item.role !== "warmup");
  const grouped = new Map<string, typeof picked>();
  for (const item of rest) {
    const key = item.clip.category;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  const groups = [...grouped.values()];
  const rotation = groups.length ? dayOffset % groups.length : 0;
  const rotatedGroups = [...groups.slice(rotation), ...groups.slice(0, rotation)];
  const ordered = [...warmups, ...rotatedGroups.flat()];

  let exercises = ordered.map((item) => buildExercise(item.clip, item.role, context, perSetMinutes));
  exercises = ensureShooting(exercises, pool, context, day, block);
  exercises = injectMissingCoreDrills(exercises, pool, context, day, block, perSetMinutes);
  exercises = enforceWorkoutCoreSequence(
    exercises,
    pool,
    context,
    day,
    block,
    perSetMinutes,
    dayNumber
  );
  exercises = ensureMeasurable(exercises, perSetMinutes);
  exercises = orderedWorkoutExercises(exercises);

  const plannedMinutes = exercises.reduce(
    (total, exercise) => total + parseExerciseMinutes(exercise),
    0
  );
  // Exercise durations cover active reps only. Account for setup, water, and
  // transitions so a 75-minute preference does not appear as a 52-minute plan.
  const transitionMinutes = 5 + exercises.length * 1.5;
  const estimatedMinutes = plannedMinutes + transitionMinutes;

  const focusCategories = [
    ...new Set(
      exercises
        .filter((exercise) => exercise.allocation_role !== "warmup")
        .map((exercise) => exercise.category)
    ),
  ].slice(0, 3);

  return {
    day_number: dayNumber,
    title: isBenchmarkDay ? `Day ${dayNumber} · Benchmark` : `Day ${dayNumber}`,
    focus: focusCategories.join(", ") || "Balanced skills",
    estimated_minutes: Math.min(composition.minutes, Math.max(10, Math.round(estimatedMinutes))),
    coach_notes: isBenchmarkDay
      ? "Benchmark session: repeat your baseline drills and try to beat your previous numbers."
      : `Emphasis on ${adaptiveProfile.weaknesses.join(" and ")}; keep ${adaptiveProfile.strengths.join(" and ")} sharp.`,
    exercises,
  };
}

// ---------------------------------------------------------------------------
// Block construction
// ---------------------------------------------------------------------------

export interface SmartPlanInput {
  startDayNumber: number;
  blockIndex: number;
  /** Stable user/plan identity used for retry-safe randomized choices. */
  randomSeed?: string;
  adaptiveProfile: AdaptiveProfile;
  composition: CompositionRules;
  daysPerWeek: number;
  mainGoal: string | null;
  preferredDifficulty?: string | null;
  preferredPosition?: string | null;
  hasCourtAccess: boolean;
  samples: PerformanceSample[];
}

export function buildSmartPlan(clips: PlanClip[], input: SmartPlanInput): SmartPlan {
  const history = buildDrillHistory(input.samples);
  const context: BuildContext = {
    startDayNumber: input.startDayNumber,
    blockIndex: input.blockIndex,
    randomSeed: input.randomSeed ?? "default-plan",
    adaptiveProfile: input.adaptiveProfile,
    composition: input.composition,
    daysPerWeek: input.daysPerWeek,
    mainGoal: input.mainGoal,
    preferredDifficulty: input.preferredDifficulty ?? null,
    preferredPosition: input.preferredPosition ?? null,
    hasCourtAccess: input.hasCourtAccess,
    history,
  };

  const totalSlots = 5 * input.composition.totalExercises;
  const block: BlockPickState = {
    tracker: createMixTracker(totalSlots, history.byClipId.size),
    usageCount: new Map(),
  };

  const days: SmartDay[] = [];
  let previousDayClipIds = history.lastSessionClipIds;
  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const day = buildDay(clips, context, dayOffset, block, previousDayClipIds);
    days.push(day);
    previousDayClipIds = new Set(day.exercises.map((exercise) => exercise.video_clip_id));
  }

  const blockLabel = input.blockIndex > 1 ? `Block ${input.blockIndex}` : "Starter Block";
  const goal = input.mainGoal ? ` toward ${input.mainGoal.toLowerCase()}` : "";

  return {
    title: `Adaptive Plan · ${blockLabel}`,
    summary: `Five personalized workouts${goal}, tuned to your recent performance.`,
    duration_weeks: 1,
    days_per_week: input.daysPerWeek,
    days: enforcePlanRequirements(days, clips, context, false),
  };
}

function stablePositiveHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fillDeficientDay(
  exercises: SmartExercise[],
  dayNumber: number,
  pool: PlanClip[],
  context: BuildContext,
  dayState: DayPickState,
  block: BlockPickState,
  perSetMinutes: number
): SmartExercise[] {
  const missing = context.composition.totalExercises - exercises.length;
  if (missing <= 0) return exercises;

  // Random-looking but stable across retries, so an idempotent generation
  // request always produces the same workout.
  const seed = stablePositiveHash(
    `${context.randomSeed}:${context.blockIndex}:${dayNumber}:deficit-fill`
  );
  const requested = (seed % 3) + 1;
  const additions = Math.min(missing, requested);
  const categories = [...new Set(pool.map((clip) => clip.category))];
  const result = [...exercises];

  for (let index = 0; index < additions; index++) {
    let candidates = pool.filter(
      (clip) =>
        categories.includes(clip.category) &&
        !dayState.usedInDay.has(clip.id) &&
        !context.history.painExcludedCategories.has(clip.category)
    );
    const nonConsecutive = candidates.filter(
      (clip) => !dayState.previousDayClipIds.has(clip.id)
    );
    if (nonConsecutive.length) candidates = nonConsecutive;
    if (dayState.highIntensityCount >= dayState.highIntensityLimit) {
      candidates = candidates.filter((clip) => !isHighIntensity(clip));
    }
    candidates.sort(
      (a, b) =>
        stablePositiveHash(`${seed}:${index}:${a.id}`) -
          stablePositiveHash(`${seed}:${index}:${b.id}`) ||
        a.id.localeCompare(b.id)
    );
    const clip = candidates[0] ?? null;
    if (!clip) break;
    commitClip(clip, dayState, block);
    result.push(buildExercise(clip, "other", context, perSetMinutes));
  }

  return result;
}

function enforcePlanRequirements(
  days: SmartDay[],
  pool: PlanClip[],
  context: BuildContext,
  fillDeficits: boolean
): SmartDay[] {
  const block: BlockPickState = {
    tracker: createMixTracker(days.length * context.composition.totalExercises, 0),
    usageCount: new Map(),
  };

  const repairedDays: SmartDay[] = [];
  for (let dayOffset = 0; dayOffset < days.length; dayOffset++) {
    const day = days[dayOffset];
    const dayState: DayPickState = {
      usedInDay: new Set(day.exercises.map((exercise) => exercise.video_clip_id)),
      highIntensityCount: 0,
      highIntensityLimit: 2,
      previousDayClipIds: new Set(
        dayOffset > 0
          ? repairedDays[dayOffset - 1].exercises.map(
              (exercise) => exercise.video_clip_id
            )
          : []
      ),
    };

    let exercises = [...day.exercises];
    const perSetMinutes = minutesPerSet(context.composition, 2);

    if (context.hasCourtAccess && !context.history.painExcludedCategories.has("shooting")) {
      let shootingCount = exercises.filter((exercise) => exercise.category === "shooting").length;
      const minShooting = 2;
      while (shootingCount < minShooting) {
        const clip = findCategoryClip(pool, "shooting", context, dayState, block, "core_required");
        if (!clip) break;
        commitClip(clip, dayState, block);
        exercises = insertCategoryExercise(
          exercises,
          clip,
          "core_required",
          context,
          perSetMinutes
        );
        shootingCount += 1;
      }
    }

    if (fillDeficits) {
      exercises = fillDeficientDay(
        exercises,
        day.day_number,
        pool,
        context,
        dayState,
        block,
        perSetMinutes
      );
    }

    exercises = enforceWorkoutCoreSequence(
      exercises.slice(0, context.composition.totalExercises),
      pool,
      context,
      dayState,
      block,
      perSetMinutes,
      day.day_number
    );

    const plannedMinutes = exercises.reduce(
      (total, exercise) => total + parseExerciseMinutes(exercise),
      0
    );
    const estimatedMinutes = plannedMinutes + 5 + exercises.length * 1.5;

    repairedDays.push({
      ...day,
      estimated_minutes: Math.min(
        context.composition.minutes,
        Math.max(10, Math.round(estimatedMinutes))
      ),
      exercises,
    });
  }
  return repairedDays;
}

export function repairSmartPlan(
  plan: SmartPlan,
  pool: PlanClip[],
  input: SmartPlanInput
): SmartPlan {
  const history = buildDrillHistory(input.samples);
  const context: BuildContext = {
    startDayNumber: input.startDayNumber,
    blockIndex: input.blockIndex,
    randomSeed: input.randomSeed ?? "default-plan",
    adaptiveProfile: input.adaptiveProfile,
    composition: input.composition,
    daysPerWeek: input.daysPerWeek,
    mainGoal: input.mainGoal,
    preferredDifficulty: input.preferredDifficulty ?? null,
    preferredPosition: input.preferredPosition ?? null,
    hasCourtAccess: input.hasCourtAccess,
    history,
  };
  return {
    ...plan,
    days: enforcePlanRequirements(plan.days, pool, context, true),
  };
}
