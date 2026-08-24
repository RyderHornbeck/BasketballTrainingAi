// Supabase Edge Function: generate-plan
// ----------------------------------------------------------------------------
// Generates adaptive five-workout blocks with a deterministic algorithm
// (see _shared/smartPlan.ts). GPT-5 no longer generates plan structure; it is
// only used to make small, validated tweaks to extension blocks based on the
// user's written exercise notes.
//
// Deploy with:
//   supabase functions deploy generate-plan
//
// Required secrets (set with `supabase secrets set`):
//   OPENAI_API_KEY  (optional -- without it the tweak pass is skipped)
//   OPENAI_MODEL    (optional, defaults to "gpt-5")
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically provided by
// the Edge Function runtime -- do not set them manually.
// ----------------------------------------------------------------------------

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hasCurrentAIDataConsent } from "../_shared/aiDataConsent.ts";
import { isCatalogOnlyVideoId } from "../_shared/exerciseClip.ts";
import {
  AdaptiveProfile,
  buildAdaptiveProfile,
  buildCompositionRules,
  CompositionRules,
  PerformanceSample,
} from "../_shared/adaptivePlan.ts";
import {
  buildSmartPlan,
  extractUserNotes,
  isRequiredWorkoutCoreClip,
  repairSmartPlan,
  SmartExercise,
  SmartPlan,
} from "../_shared/smartPlan.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced", "elite"];

const DIFFICULTY_ALLOWANCE: Record<string, string[]> = {
  beginner: ["beginner", "intermediate"],
  intermediate: ["beginner", "intermediate", "advanced"],
  advanced: ["intermediate", "advanced"],
  elite: ["advanced", "elite"],
};

const GOAL_CATEGORY_MAP: Record<string, string[]> = {
  "make the team": [
    "shooting",
    "ball_handling",
    "finishing",
    "defense",
    "conditioning",
  ],
  "improve shooting": ["shooting"],
  "improve handles": ["ball_handling"],
  "improve finishing": ["finishing"],
  "improve defense": ["defense"],
  "get faster": ["conditioning", "footwork"],
  "improve conditioning": ["conditioning"],
  "become stronger": ["strength"],
  "become an all-around better player": [
    "shooting",
    "ball_handling",
    "finishing",
    "defense",
    "conditioning",
  ],
};

const WEAKNESS_KEYWORD_CATEGORY: Array<[RegExp, string]> = [
  [/shoot/i, "shooting"],
  [/handl|dribbl/i, "ball_handling"],
  [/finish|layup|mikan|floater/i, "finishing"],
  [/defen/i, "defense"],
  [/condition|cardio|stamina|gas/i, "conditioning"],
  [/strength|weak|weight/i, "strength"],
  [/footwork|foot work/i, "footwork"],
  [/mobil|flexib/i, "mobility"],
  [/discipline|iq|decision/i, "basketball_iq"],
];

interface OnboardingAnswers {
  id: string;
  user_id: string;
  overall_skill_level: string | null;
  playing_level: string | null;
  main_goal: string | null;
  position: string | null;
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
  days_per_week: number | null;
  minutes_per_workout: number | null;
  has_court_access: boolean | null;
  equipment: string[] | null;
  injuries_limitations: string | null;
  preferred_intensity: string | null;
}

interface VideoClip {
  id: string;
  exercise_name: string;
  category: string;
  difficulty_level: string | null;
  description: string | null;
  coaching_notes: string | null;
  requires_both_sides: boolean | null;
  source_section: string | null;
  equipment: string[] | null;
  weaknesses: string[] | null;
  positions: string[] | null;
  skill_levels: string[] | null;
  youtube_video_id: string | null;
}

interface GenerationContext {
  generationType: "initial" | "extend";
  targetPlanId: string | null;
  blockIndex: number;
  startDayNumber: number;
  adaptiveProfile: AdaptiveProfile;
  composition: CompositionRules;
  samples: PerformanceSample[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Clip filtering / ranking (input pool for the algorithm)
// ---------------------------------------------------------------------------

function scoreClip(
  clip: VideoClip,
  answers: OnboardingAnswers,
  adaptiveProfile?: AdaptiveProfile,
): number {
  let score = 0;

  const goalCategories = (answers.main_goal ?? "")
    .split(",")
    .flatMap((goal) => GOAL_CATEGORY_MAP[goal.trim().toLowerCase()] ?? []);
  if (goalCategories.includes(clip.category)) score += 3;

  const weaknessText = (answers.weaknesses ?? "").toLowerCase();
  for (const [regex, category] of WEAKNESS_KEYWORD_CATEGORY) {
    if (regex.test(weaknessText) && clip.category === category) {
      score += 2;
      break;
    }
  }

  const userLevel = (answers.overall_skill_level ?? "beginner").toLowerCase();
  if (clip.difficulty_level === userLevel) score += 1;

  const userPosition = (answers.position ?? "unknown").trim().toLowerCase();
  if (
    userPosition !== "unknown" &&
    (clip.positions ?? []).some((position) => {
      const normalized = position.trim().toLowerCase();
      return normalized === userPosition || normalized.includes(userPosition);
    })
  ) {
    score += 2;
  }

  if (!answers.has_court_access) {
    if (
      ["ball_handling", "footwork", "strength", "mobility", "conditioning"]
        .includes(clip.category)
    ) {
      score += 1;
    }
    if (clip.category === "shooting") score -= 1;
  }

  if (
    adaptiveProfile?.weaknesses.some((category) => category === clip.category)
  ) score += 5;
  if (
    adaptiveProfile?.strengths.some((category) => category === clip.category)
  ) score += 3;

  return score;
}

function clipEquipmentCompatible(
  clip: VideoClip,
  answers: OnboardingAnswers,
): boolean {
  const available = new Set(
    (answers.equipment ?? []).map((item) => item.toLowerCase()),
  );
  const requirements = (clip.equipment ?? []).map((item) => item.toLowerCase());
  for (const requirement of requirements) {
    if (
      (requirement.includes("hoop") ||
        requirement.includes("basket") ||
        requirement.includes("court")) &&
      !answers.has_court_access
    ) {
      return false;
    }
    if (requirement.includes("cone") && !available.has("cones")) return false;
    if (requirement.includes("band") && !available.has("resistance bands")) {
      return false;
    }
    if (
      (requirement.includes("weight") || requirement.includes("dumbbell")) &&
      !available.has("weights")
    ) {
      return false;
    }
    if (
      (requirement === "ball" || requirement.includes("basketball")) &&
      !available.has("basketball")
    ) {
      return false;
    }
  }
  return true;
}

function dedupeClips(clips: VideoClip[]): VideoClip[] {
  const seen = new Set<string>();
  const merged: VideoClip[] = [];
  for (const clip of clips) {
    if (seen.has(clip.id)) continue;
    seen.add(clip.id);
    merged.push(clip);
  }
  return merged;
}

function buildClipPool(
  clips: VideoClip[],
  answers: OnboardingAnswers,
  adaptiveProfile: AdaptiveProfile,
): VideoClip[] {
  const level = (answers.overall_skill_level ?? "beginner").toLowerCase();
  const allowedDifficulties = DIFFICULTY_ALLOWANCE[level] ?? DIFFICULTY_ORDER;

  const difficultyOk = (c: VideoClip) =>
    !c.difficulty_level || allowedDifficulties.includes(c.difficulty_level);

  const strict = clips.filter((c) =>
    difficultyOk(c) && clipEquipmentCompatible(c, answers)
  );
  // Never let equipment filtering starve the pool.
  let pool = strict.length >= 20 ? strict : clips.filter(difficultyOk);
  // Core warm-up/progression drills are structural requirements, so retain
  // them even when their catalog difficulty differs from the athlete's tier.
  pool = dedupeClips([
    ...pool,
    ...clips.filter((clip) =>
      isRequiredWorkoutCoreClip(clip, Boolean(answers.has_court_access))
    ),
  ]);

  // Court access must always include hoop work, even when skill tier filters
  // would otherwise remove every shooting clip (e.g. elite users vs beginner drills).
  if (
    answers.has_court_access &&
    !pool.some((clip) => clip.category === "shooting")
  ) {
    pool = dedupeClips([
      ...pool,
      ...clips.filter((clip) =>
        clip.category === "shooting" && difficultyOk(clip)
      ),
    ]);
  }

  // Restore core categories only from the athlete's allowed difficulty range.
  for (const category of ["ball_handling", "finishing", "defense"] as const) {
    if (!pool.some((clip) => clip.category === category)) {
      pool = dedupeClips([
        ...pool,
        ...clips.filter((clip) =>
          clip.category === category && difficultyOk(clip)
        ),
      ]);
    }
  }

  return [...pool].sort(
    (a, b) =>
      scoreClip(b, answers, adaptiveProfile) -
        scoreClip(a, answers, adaptiveProfile) ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// GPT-5 tweak pass (extension blocks only, driven by user exercise notes)
// ---------------------------------------------------------------------------

interface UserNoteEntry {
  dayNumber: number;
  exerciseName: string;
  category: string;
  note: string;
}

function collectRecentUserNotes(
  samples: PerformanceSample[],
  startDayNumber: number,
  clipNameById: Map<string, string>,
): UserNoteEntry[] {
  const previousBlockStart = Math.max(1, startDayNumber - 5);
  return samples.flatMap((sample) => {
    if (
      sample.dayNumber < previousBlockStart ||
      sample.dayNumber >= startDayNumber
    ) return [];
    const note = extractUserNotes(sample.notes);
    if (!note) return [];
    return [{
      dayNumber: sample.dayNumber,
      exerciseName:
        (sample.videoClipId ? clipNameById.get(sample.videoClipId) : null) ??
          sample.category,
      category: sample.category,
      note,
    }];
  });
}

interface PlanTweak {
  day_number: number;
  order_index: number;
  action: "swap_drill" | "adjust_volume" | "adjust_targets";
  video_clip_id?: string;
  sets?: string;
  target_makes?: number;
  target_attempts?: number;
  reason?: string;
}

function buildTweakSystemPrompt(): string {
  return `You are a basketball coach reviewing an already-built five-day workout block.
The block was generated by a deterministic training algorithm and is structurally final.
You may ONLY suggest small tweaks motivated by the user's written notes on recent exercises.

Allowed tweak actions:
- "swap_drill": replace one exercise with a different catalog drill of the SAME category (provide video_clip_id from alternatives).
- "adjust_volume": change an exercise's set count (sets must be a string integer between "1" and "5").
- "adjust_targets": change target_makes/target_attempts for a shooting drill (makes must be less than or equal to attempts).

Rules:
- Suggest at most 5 tweaks total. Zero tweaks is a valid answer if the notes don't call for changes.
- Only tweak exercises that clearly relate to a user note (same drill, same category, or the issue described).
- If a note mentions pain or discomfort, swap the related drill for a gentler alternative of the same category or reduce its volume.
- If a note says a drill was too easy, increase targets or swap to a harder same-category alternative.
- If a note says a drill was too hard, reduce targets/sets or swap to an easier same-category alternative.
- Never change day structure, exercise counts, categories of slots, or day numbers.

Return strict JSON only:
{"tweaks":[{"day_number":number,"order_index":number,"action":"swap_drill"|"adjust_volume"|"adjust_targets","video_clip_id":string|null,"sets":string|null,"target_makes":number|null,"target_attempts":number|null,"reason":string}]}`;
}

function buildTweakUserPrompt(
  plan: SmartPlan,
  notes: UserNoteEntry[],
  alternatives: VideoClip[],
  clipById: Map<string, VideoClip>,
): string {
  const hasVideoDemo = (clip: VideoClip | undefined) =>
    Boolean(
      clip?.youtube_video_id && !isCatalogOnlyVideoId(clip.youtube_video_id),
    );

  return JSON.stringify({
    user_notes: notes,
    plan_block: plan.days.map((day) => ({
      day_number: day.day_number,
      exercises: day.exercises.map((exercise) => {
        const clip = exercise.video_clip_id
          ? clipById.get(exercise.video_clip_id)
          : undefined;
        return {
          order_index: exercise.order_index,
          name: exercise.name,
          category: exercise.category,
          video_clip_id: exercise.video_clip_id,
          has_video_demo: hasVideoDemo(clip),
          sets: exercise.sets,
          duration: exercise.duration,
          target_makes: exercise.target_makes,
          target_attempts: exercise.target_attempts,
          log_type: exercise.log_type,
        };
      }),
    })),
    alternative_drills: alternatives.map((clip) => ({
      id: clip.id,
      name: clip.exercise_name,
      category: clip.category,
      difficulty: clip.difficulty_level,
      has_video_demo: hasVideoDemo(clip),
    })),
  });
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY secret is not configured.");
  }

  const timeoutMs = 90_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    console.log(
      `[generate-plan] Calling OpenAI model=${OPENAI_MODEL}, prompt length=${userPrompt.length}`,
    );
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        // The tweak task is small; low effort keeps latency bounded.
        reasoning_effort: "low",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `OpenAI request timed out after ${
          Math.round(timeoutMs / 1000)
        } seconds.`,
      );
    }
    throw new Error(
      `OpenAI request failed to send: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }

  console.log(`[generate-plan] OpenAI responded with status ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenAI request failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include message content.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }
}

/**
 * Applies GPT tweaks to the algorithm-built plan. Every tweak is validated
 * individually; invalid tweaks are skipped rather than failing generation.
 */
function applyTweaks(
  plan: SmartPlan,
  rawTweaks: unknown,
  clipById: Map<string, VideoClip>,
): { plan: SmartPlan; applied: number } {
  const tweaks = Array.isArray((rawTweaks as Record<string, unknown>)?.tweaks)
    ? ((rawTweaks as Record<string, unknown>).tweaks as PlanTweak[])
    : [];
  let applied = 0;

  const days = plan.days.map((day) => ({
    ...day,
    exercises: [...day.exercises],
  }));

  for (const tweak of tweaks.slice(0, 5)) {
    const day = days.find((d) => d.day_number === tweak.day_number);
    if (!day) continue;
    const exerciseIndex = day.exercises.findIndex(
      (exercise) => exercise.order_index === tweak.order_index,
    );
    if (exerciseIndex < 0) continue;
    const exercise = day.exercises[exerciseIndex];

    if (tweak.action === "swap_drill") {
      const clip = tweak.video_clip_id
        ? clipById.get(tweak.video_clip_id)
        : null;
      if (!clip) continue;
      if (clip.category !== exercise.category) continue;
      if (day.exercises.some((item) => item.video_clip_id === clip.id)) {
        continue;
      }
      let setCount = Math.max(1, Number.parseInt(exercise.sets, 10) || 1);
      if (clip.category === "ball_handling") setCount = Math.max(2, setCount);
      if (clip.requires_both_sides) setCount = setCount <= 2 ? 2 : 4;
      day.exercises[exerciseIndex] = {
        ...exercise,
        video_clip_id: clip.id,
        name: clip.exercise_name,
        instructions: clip.description ?? clip.coaching_notes ??
          exercise.instructions,
        sets: String(setCount),
        set_side_labels: clip.requires_both_sides
          ? Array.from(
            { length: setCount },
            (_, index) => index % 2 === 0 ? "Right side" : "Left side",
          )
          : null,
      };
      applied++;
      continue;
    }

    if (tweak.action === "adjust_volume") {
      let sets = Number.parseInt(String(tweak.sets ?? ""), 10);
      if (!Number.isFinite(sets) || sets < 1 || sets > 5) continue;
      const clip = clipById.get(exercise.video_clip_id);
      if (!clip) continue;
      if (exercise.category === "ball_handling") sets = Math.max(2, sets);
      if (clip.requires_both_sides) sets = sets <= 2 ? 2 : 4;
      day.exercises[exerciseIndex] = {
        ...exercise,
        sets: String(sets),
        set_side_labels: clip.requires_both_sides
          ? Array.from(
            { length: sets },
            (_, index) => index % 2 === 0 ? "Right side" : "Left side",
          )
          : null,
      };
      applied++;
      continue;
    }

    if (tweak.action === "adjust_targets") {
      if (exercise.log_type !== "makes_attempts") continue;
      const proposedMakes = Number(tweak.target_makes);
      const proposedAttempts = Number(
        tweak.target_attempts ?? exercise.target_attempts,
      );
      const minimumAttempts = exercise.category === "shooting" ? 20 : 15;
      const attempts = Math.min(
        60,
        Math.max(minimumAttempts, Math.round(proposedAttempts)),
      );
      const makes = Math.max(
        Math.round(proposedMakes),
        Math.ceil(attempts * 0.5),
      );
      if (
        !Number.isFinite(proposedMakes) || !Number.isFinite(proposedAttempts)
      ) continue;
      if (makes < 1 || attempts < makes) continue;
      day.exercises[exerciseIndex] = {
        ...exercise,
        target_makes: Math.round(makes),
        target_attempts: Math.round(attempts),
      };
      applied++;
    }
  }

  return { plan: { ...plan, days }, applied };
}

async function maybeApplyGptTweaks(
  plan: SmartPlan,
  context: GenerationContext,
  pool: VideoClip[],
  clipById: Map<string, VideoClip>,
  supabase: SupabaseClient,
  userId: string,
): Promise<SmartPlan> {
  if (context.generationType !== "extend" || !OPENAI_API_KEY) return plan;

  const clipNameById = new Map(
    [...clipById].map(([id, clip]) => [id, clip.exercise_name]),
  );
  const notes = collectRecentUserNotes(
    context.samples,
    context.startDayNumber,
    clipNameById,
  );
  if (!notes.length) {
    console.log(
      "[generate-plan] No user notes in previous block; skipping GPT tweak pass.",
    );
    return plan;
  }

  // Offer same-category alternatives for every noted category (small list).
  const notedCategories = new Set(notes.map((note) => note.category));
  const usedIds = new Set(
    plan.days.flatMap((day) =>
      day.exercises.map((exercise) => exercise.video_clip_id)
    ),
  );
  const alternatives = pool
    .filter((clip) =>
      notedCategories.has(clip.category) && !usedIds.has(clip.id)
    )
    .slice(0, 40);

  try {
    if (!(await hasCurrentAIDataConsent(supabase, userId))) return plan;
    const raw = await callOpenAI(
      buildTweakSystemPrompt(),
      buildTweakUserPrompt(plan, notes, alternatives, clipById),
    );
    const { plan: tweaked, applied } = applyTweaks(plan, raw, clipById);
    console.log(`[generate-plan] GPT tweak pass applied ${applied} tweak(s).`);
    return tweaked;
  } catch (err) {
    // Tweaks are best-effort; the algorithm plan is already valid.
    console.error(
      "[generate-plan] GPT tweak pass failed, using algorithm plan:",
      err,
    );
    return plan;
  }
}

// ---------------------------------------------------------------------------
// Scheduling / data loading
// ---------------------------------------------------------------------------

function computeScheduledDate(
  dayIndexZeroBased: number,
  daysPerWeek: number,
  planStartDate?: string,
): string {
  const week = Math.floor(dayIndexZeroBased / daysPerWeek);
  const dayInWeek = dayIndexZeroBased % daysPerWeek;
  const offsetDays = week * 7 +
    Math.round((dayInWeek * 7) / Math.max(daysPerWeek, 1));
  const date = planStartDate
    ? new Date(`${planStartDate.slice(0, 10)}T12:00:00Z`)
    : new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function loadPerformanceSamples(
  supabase: SupabaseClient,
  userId: string,
): Promise<PerformanceSample[]> {
  const { data: completedDays, error: daysError } = await supabase
    .from("workout_days")
    .select("id, day_number")
    .eq("user_id", userId)
    .eq("completed", true)
    .order("day_number", { ascending: false })
    .limit(50);
  if (daysError) {
    throw new Error(`Failed to load completed workouts: ${daysError.message}`);
  }
  if (!completedDays?.length) return [];

  const dayNumberById = new Map(
    completedDays.map((day) => [day.id as string, Number(day.day_number ?? 0)]),
  );
  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select(
      "id, day_id, category, video_clip_id, sets, duration, target_makes, target_attempts, log_type, exercise_video_clips(difficulty_level), exercise_logs(completed, makes, attempts, minutes_completed, difficulty, notes)",
    )
    .in("day_id", [...dayNumberById.keys()]);
  if (exercisesError) {
    throw new Error(
      `Failed to load workout performance: ${exercisesError.message}`,
    );
  }

  return (exercises ?? []).flatMap((exercise: Record<string, unknown>) => {
    const rawLogs = exercise.exercise_logs;
    const log = Array.isArray(rawLogs) ? rawLogs[0] : rawLogs;
    const rawClip = exercise.exercise_video_clips;
    const clip = Array.isArray(rawClip) ? rawClip[0] : rawClip;
    // Keep exercises without logs as skipped entries so the algorithm can
    // carry their skill work into the next block.
    const entry = (log && typeof log === "object" ? log : {}) as Record<
      string,
      unknown
    >;
    return [{
      dayNumber: dayNumberById.get(String(exercise.day_id)) ?? 0,
      category: String(exercise.category ?? ""),
      videoClipId: exercise.video_clip_id
        ? String(exercise.video_clip_id)
        : null,
      sets: exercise.sets ? String(exercise.sets) : null,
      duration: exercise.duration ? String(exercise.duration) : null,
      targetMakes: typeof exercise.target_makes === "number"
        ? exercise.target_makes
        : null,
      targetAttempts: typeof exercise.target_attempts === "number"
        ? exercise.target_attempts
        : null,
      logType: exercise.log_type ? String(exercise.log_type) : null,
      completed: entry.completed === true,
      makes: typeof entry.makes === "number" ? entry.makes : null,
      attempts: typeof entry.attempts === "number" ? entry.attempts : null,
      minutesCompleted: typeof entry.minutes_completed === "number"
        ? entry.minutes_completed
        : null,
      difficulty: typeof entry.difficulty === "number"
        ? entry.difficulty
        : null,
      prescribedDifficulty: clip && typeof clip === "object" &&
          typeof (clip as Record<string, unknown>).difficulty_level === "string"
        ? String((clip as Record<string, unknown>).difficulty_level)
        : null,
      notes: typeof entry.notes === "string" ? entry.notes : null,
    }];
  });
}

async function buildGenerationContext(
  supabase: SupabaseClient,
  userId: string,
  answers: OnboardingAnswers,
  generationType: "initial" | "extend",
  targetPlanId: string | null,
  requestedBlockIndex: number,
): Promise<GenerationContext> {
  const samples = await loadPerformanceSamples(supabase, userId);
  const adaptiveProfile = buildAdaptiveProfile(answers, samples);
  const composition = buildCompositionRules(answers.minutes_per_workout ?? 45);

  if (generationType === "initial") {
    return {
      generationType,
      targetPlanId: null,
      blockIndex: 1,
      startDayNumber: 1,
      adaptiveProfile,
      composition,
      samples,
    };
  }

  if (!targetPlanId) throw new Error("An extension requires target_plan_id.");
  const { data: plan } = await supabase
    .from("workout_plans")
    .select("id")
    .eq("id", targetPlanId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!plan) throw new Error("Active plan for extension was not found.");

  const { data: latestDay } = await supabase
    .from("workout_days")
    .select("day_number, block_index")
    .eq("plan_id", targetPlanId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxDayNumber = Number(latestDay?.day_number ?? 0);
  const expectedBlockIndex = Number(latestDay?.block_index ?? 0) + 1;
  if (requestedBlockIndex !== expectedBlockIndex) {
    throw new Error(
      `Expected block ${expectedBlockIndex}, received ${requestedBlockIndex}.`,
    );
  }

  return {
    generationType,
    targetPlanId,
    blockIndex: expectedBlockIndex,
    startDayNumber: maxDayNumber + 1,
    adaptiveProfile,
    composition,
    samples,
  };
}

async function markRequestFailed(
  supabase: SupabaseClient,
  requestId: string,
  message: string,
) {
  const { data: request } = await supabase
    .from("plan_generation_requests")
    .select("generation_type, target_plan_id, block_index")
    .eq("id", requestId)
    .maybeSingle();

  if (request?.generation_type === "extend" && request.target_plan_id) {
    // Extension writes happen one day at a time. Remove any partial block so
    // the completed plan remains unchanged and a retry starts cleanly.
    await supabase
      .from("workout_days")
      .delete()
      .eq("plan_id", request.target_plan_id)
      .eq("block_index", Number(request.block_index ?? 1));
  }

  await supabase
    .from("plan_generation_requests")
    .update({ status: "failed", error_message: message.slice(0, 2000) })
    .eq("id", requestId);
}

/** Final sanity check before writing to Postgres. */
function sanityCheckPlan(
  plan: SmartPlan,
  clipById: Map<string, VideoClip>,
  context: GenerationContext,
  answers: OnboardingAnswers,
): string | null {
  if (plan.days.length !== 5) return "Plan must contain exactly five days.";
  const level = (answers.overall_skill_level ?? "beginner").toLowerCase();
  const allowedDifficulties = DIFFICULTY_ALLOWANCE[level] ?? DIFFICULTY_ORDER;
  for (let index = 0; index < plan.days.length; index++) {
    const day = plan.days[index];
    if (day.day_number !== context.startDayNumber + index) {
      return `Day numbering is wrong at position ${index + 1}.`;
    }
    if (!day.exercises.length) return `Day ${day.day_number} has no exercises.`;
    if (day.exercises.length > context.composition.totalExercises) {
      return `Day ${day.day_number} exceeds its configured exercise count.`;
    }
    const seen = new Set<string>();
    for (const exercise of day.exercises) {
      const clip = clipById.get(exercise.video_clip_id);
      if (!clip) {
        return `Exercise "${exercise.name}" references an unknown video clip.`;
      }
      if (
        clip.difficulty_level &&
        !allowedDifficulties.includes(clip.difficulty_level) &&
        !isRequiredWorkoutCoreClip(clip, Boolean(answers.has_court_access))
      ) {
        return `Exercise "${exercise.name}" is outside the athlete's allowed difficulty range.`;
      }
      if (seen.has(exercise.video_clip_id)) {
        return `Day ${day.day_number} repeats a video clip.`;
      }
      seen.add(exercise.video_clip_id);
      const setCount = Number.parseInt(exercise.sets, 10) || 1;
      if (exercise.category === "ball_handling" && setCount < 2) {
        return `"${exercise.name}" must have at least two ball-handling sets.`;
      }
      if (
        exercise.set_side_labels &&
        (setCount !== exercise.set_side_labels.length ||
          ![2, 4].includes(setCount))
      ) {
        return `"${exercise.name}" must use two or four balanced side sets.`;
      }
      if (
        exercise.category === "shooting" || exercise.category === "finishing"
      ) {
        const minimumAttempts = exercise.category === "shooting" ? 20 : 15;
        if (
          exercise.target_attempts == null ||
          exercise.target_makes == null ||
          exercise.target_attempts < minimumAttempts ||
          exercise.target_makes < Math.ceil(exercise.target_attempts * 0.5)
        ) {
          return `"${exercise.name}" has an invalid makes/attempts target.`;
        }
      }
    }
    if (answers.has_court_access) {
      const shootingCount = day.exercises.filter((exercise) =>
        exercise.category === "shooting"
      ).length;
      if (shootingCount < 2) {
        return `Day ${day.day_number} must include at least two shooting drills when court access is available.`;
      }
    }
    for (const exercise of day.exercises) {
      if (
        (exercise.category === "shooting" ||
          exercise.category === "finishing") &&
        (exercise.target_attempts == null || exercise.target_attempts > 60)
      ) {
        return `"${exercise.name}" must have 60 or fewer attempts per set.`;
      }
    }
  }
  return null;
}

// Supabase-specific global available in the Edge Function (Deno Deploy)
// runtime. Declared here since it isn't part of the standard Deno types.
declare const EdgeRuntime:
  | { waitUntil: (promise: Promise<unknown>) => void }
  | undefined;

/**
 * Does the slow work: builds the block with the deterministic algorithm,
 * optionally lets GPT-5 apply note-driven tweaks, and writes everything to
 * Postgres. Runs as a background task via `EdgeRuntime.waitUntil` so the HTTP
 * response can return immediately; the client polls plan_generation_requests.
 */
async function runGeneration(
  supabase: SupabaseClient,
  requestId: string,
  userId: string,
  answers: OnboardingAnswers,
  context: GenerationContext,
): Promise<void> {
  try {
    // Onboarding always assumes a standard court and one basketball.
    const trainingAnswers: OnboardingAnswers = {
      ...answers,
      has_court_access: true,
      equipment: ["Basketball"],
    };
    const { data: allClips, error: clipsError } = await supabase
      .from("exercise_video_clips")
      .select(
        "id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides, source_section, equipment, weaknesses, positions, skill_levels, youtube_video_id",
      )
      .eq("active", true);

    if (clipsError || !allClips || allClips.length === 0) {
      await markRequestFailed(
        supabase,
        requestId,
        "No active exercise video clips available.",
      );
      return;
    }

    const pool = buildClipPool(
      allClips as VideoClip[],
      trainingAnswers,
      context.adaptiveProfile,
    ).map(
      (clip) => ({
        ...clip,
        requires_both_sides: clip.requires_both_sides ?? false,
      }),
    );
    const allClipPool = (allClips as VideoClip[]).map((clip) => ({
      ...clip,
      requires_both_sides: clip.requires_both_sides ?? false,
    }));
    const clipById = new Map(allClipPool.map((clip) => [clip.id, clip]));

    // 1. Deterministic generation -- always succeeds if the pool is non-empty.
    const generationSeed = context.targetPlanId ?? userId;
    let plan: SmartPlan = buildSmartPlan(pool, {
      startDayNumber: context.startDayNumber,
      blockIndex: context.blockIndex,
      randomSeed: generationSeed,
      adaptiveProfile: context.adaptiveProfile,
      composition: context.composition,
      daysPerWeek: answers.days_per_week ?? 3,
      mainGoal: answers.main_goal,
      preferredDifficulty: trainingAnswers.overall_skill_level,
      preferredPosition: trainingAnswers.position,
      hasCourtAccess: true,
      samples: context.samples,
    });

    // 2. Optional GPT-5 tweak pass driven by the user's exercise notes.
    // Deterministic generation remains available after denial; only the
    // provider-adjacent enhancement requires consent.
    plan = await maybeApplyGptTweaks(
      plan,
      context,
      pool,
      clipById,
      supabase,
      userId,
    );

    const planInput = {
      startDayNumber: context.startDayNumber,
      blockIndex: context.blockIndex,
      randomSeed: generationSeed,
      adaptiveProfile: context.adaptiveProfile,
      composition: context.composition,
      daysPerWeek: answers.days_per_week ?? 3,
      mainGoal: answers.main_goal,
      preferredDifficulty: trainingAnswers.overall_skill_level,
      preferredPosition: trainingAnswers.position,
      hasCourtAccess: true,
      samples: context.samples,
    };
    // Repair only from the athlete's equipment- and difficulty-compatible
    // pool. The full catalog remains available above solely for validation.
    plan = repairSmartPlan(plan, pool, planInput);

    const sanityError = sanityCheckPlan(
      plan,
      clipById,
      context,
      trainingAnswers,
    );
    if (sanityError) {
      await markRequestFailed(
        supabase,
        requestId,
        `Plan generation failed: ${sanityError}`,
      );
      return;
    }

    // 3. Persist.
    let planRow: Record<string, unknown> | null = null;
    if (context.generationType === "extend" && context.targetPlanId) {
      const { data, error } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("id", context.targetPlanId)
        .eq("user_id", userId)
        .eq("active", true)
        .single();
      if (error || !data) {
        await markRequestFailed(
          supabase,
          requestId,
          "The active plan could not be extended.",
        );
        return;
      }
      planRow = data;
      // A failed prior attempt may have inserted only part of this block.
      await supabase
        .from("workout_days")
        .delete()
        .eq("plan_id", context.targetPlanId)
        .eq("block_index", context.blockIndex);
    } else {
      const { data, error } = await supabase
        .from("workout_plans")
        .insert({
          user_id: userId,
          title: plan.title,
          summary: plan.summary,
          duration_weeks: 1,
          days_per_week: answers.days_per_week ?? plan.days_per_week ?? 3,
          active: false,
        })
        .select()
        .single();
      if (error || !data) {
        await markRequestFailed(
          supabase,
          requestId,
          `Failed to insert workout plan: ${error?.message}`,
        );
        return;
      }
      planRow = data;
    }

    if (!planRow) {
      await markRequestFailed(
        supabase,
        requestId,
        "Failed to resolve workout plan.",
      );
      return;
    }
    const planId = String(planRow.id);
    const sortedDays = [...plan.days].sort((a, b) =>
      a.day_number - b.day_number
    );
    const daysPerWeek = answers.days_per_week || plan.days_per_week || 3;

    for (const day of sortedDays) {
      const isFirstGeneratedDay = day.day_number === context.startDayNumber;

      const { data: dayRow, error: dayInsertError } = await supabase
        .from("workout_days")
        .insert({
          plan_id: planId,
          user_id: userId,
          day_number: day.day_number,
          block_index: context.blockIndex,
          title: day.title,
          focus: day.focus,
          estimated_minutes: day.estimated_minutes,
          coach_notes: day.coach_notes,
          // A new five-day extension is requested only after the preceding
          // block is complete, so its first day must be immediately available.
          // Subsequent days still unlock one at a time.
          locked: !isFirstGeneratedDay,
          completed: false,
          scheduled_date: null,
        })
        .select()
        .single();

      if (dayInsertError || !dayRow) {
        await markRequestFailed(
          supabase,
          requestId,
          `Failed to insert workout day: ${dayInsertError?.message}`,
        );
        return;
      }

      const exerciseRows = day.exercises.map((ex: SmartExercise) => ({
        day_id: dayRow.id,
        user_id: userId,
        video_clip_id: ex.video_clip_id,
        order_index: ex.order_index,
        name: ex.name,
        category: ex.category,
        instructions: ex.instructions,
        sets: ex.sets ?? null,
        reps: ex.reps ?? null,
        duration: ex.duration ?? null,
        target_makes: ex.target_makes ?? null,
        target_attempts: ex.target_attempts ?? null,
        log_type: ex.log_type,
        set_side_labels: ex.set_side_labels ?? null,
      }));

      const { error: exercisesInsertError } = await supabase.from(
        "workout_exercises",
      ).insert(exerciseRows);
      if (exercisesInsertError) {
        await markRequestFailed(
          supabase,
          requestId,
          `Failed to insert workout exercises: ${exercisesInsertError.message}`,
        );
        return;
      }
    }

    const totalDays = context.startDayNumber + 4;
    await supabase
      .from("workout_plans")
      .update({
        title: plan.title,
        summary: plan.summary,
        duration_weeks: Math.max(
          1,
          Math.ceil(totalDays / Math.max(daysPerWeek, 1)),
        ),
        days_per_week: daysPerWeek,
      })
      .eq("id", planId);

    if (context.generationType === "initial") {
      await supabase
        .from("workout_plans")
        .update({ active: false })
        .eq("user_id", userId)
        .eq("active", true)
        .neq("id", planId);
      await supabase.from("workout_plans").update({ active: true }).eq(
        "id",
        planId,
      );
    }

    await supabase
      .from("plan_generation_requests")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", requestId);

    console.log(
      `[generate-plan] Completed request ${requestId} -> plan ${planId}, block ${context.blockIndex}`,
    );
  } catch (err) {
    console.error("generate-plan background task error:", err);
    await markRequestFailed(
      supabase,
      requestId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Verify the authenticated user from the request.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(
      jwt,
    );
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    // 2. Accept a request_id.
    const body = await req.json().catch(() => ({}));
    const requestId: string | undefined = body.request_id;
    if (!requestId) {
      return jsonResponse({ error: "request_id is required" }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId)) {
      return jsonResponse({ error: "Invalid request_id" }, 400);
    }

    // 3. Load the matching generation request (must belong to this user).
    const { data: genRequest, error: genRequestError } = await supabase
      .from("plan_generation_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", userId)
      .single();

    if (genRequestError || !genRequest) {
      return jsonResponse({ error: "Generation request not found" }, 404);
    }
    if (
      genRequest.status === "completed" || genRequest.status === "generating"
    ) {
      return jsonResponse({ success: true, status: genRequest.status });
    }
    if (genRequest.status !== "pending") {
      return jsonResponse({ error: "Generation request is not pending" }, 409);
    }

    // 4. Load the user's latest onboarding answers.
    const { data: answersRows, error: answersError } = await supabase
      .from("onboarding_answers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (answersError || !answersRows || answersRows.length === 0) {
      await markRequestFailed(
        supabase,
        requestId,
        "No onboarding answers found for user.",
      );
      return jsonResponse({ error: "No onboarding answers found" }, 400);
    }
    const answers = answersRows[0] as OnboardingAnswers;

    const generationType = genRequest.generation_type === "extend"
      ? "extend" as const
      : "initial" as const;
    if (generationType === "extend" && genRequest.target_plan_id) {
      const { data: failedAttempt } = await supabase
        .from("plan_generation_requests")
        .select("id")
        .eq("target_plan_id", genRequest.target_plan_id)
        .eq("block_index", Number(genRequest.block_index ?? 1))
        .eq("status", "failed")
        .limit(1)
        .maybeSingle();
      if (failedAttempt) {
        await supabase
          .from("workout_days")
          .delete()
          .eq("plan_id", genRequest.target_plan_id)
          .eq("block_index", Number(genRequest.block_index ?? 1));
      }
    }
    let context: GenerationContext;
    try {
      context = await buildGenerationContext(
        supabase,
        userId,
        answers,
        generationType,
        genRequest.target_plan_id ?? null,
        Number(genRequest.block_index ?? 1),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markRequestFailed(supabase, requestId, message);
      return jsonResponse({ error: message }, 400);
    }

    const { data: claimedRequest } = await supabase
      .from("plan_generation_requests")
      .update({ status: "generating", error_message: null })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimedRequest) {
      return jsonResponse({ success: true, status: "generating" });
    }

    const backgroundTask = runGeneration(
      supabase,
      requestId,
      userId,
      answers,
      context,
    );

    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(backgroundTask);
    } else {
      // Local `supabase functions serve` doesn't provide EdgeRuntime -- just
      // await it directly so local dev still works end to end.
      await backgroundTask;
    }

    return jsonResponse({ success: true, status: "generating" });
  } catch (err) {
    console.error("generate-plan error:", err);
    return jsonResponse({ error: "Plan generation failed" }, 500);
  }
});
