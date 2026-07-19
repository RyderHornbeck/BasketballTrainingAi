// Smoke test for the deterministic generator. Run with:
//   npx tsx supabase/functions/_shared/smartPlan.smoke.ts
import { buildAdaptiveProfile, buildCompositionRules, PerformanceSample } from "./adaptivePlan.ts";
import {
  buildDrillHistory,
  buildSmartPlan,
  classifyClip,
  determineNextDifficulty,
  detectPainExclusions,
  PlanClip,
  repairSmartPlan,
} from "./smartPlan.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// --- Synthetic catalog -------------------------------------------------------
const categories = [
  "warmup",
  "shooting",
  "ball_handling",
  "finishing",
  "defense",
  "footwork",
  "conditioning",
  "strength",
  "basketball_iq",
];
const difficulties = ["beginner", "intermediate", "advanced"];
const clips: PlanClip[] = [];
let id = 0;
for (const category of categories) {
  for (const difficulty of difficulties) {
    for (let i = 0; i < 6; i++) {
      clips.push({
        id: `clip-${++id}`,
        exercise_name: `${category} drill ${difficulty} ${i}`,
        category,
        difficulty_level: difficulty,
        description: "desc",
        coaching_notes: null,
        requires_both_sides:
          ["shooting", "finishing", "ball_handling"].includes(category) && i % 2 === 0,
      });
    }
  }
}

const answers = {
  strengths: "finishing at the rim",
  weaknesses: "shooting consistency",
  shooting_level: "4",
  ball_handling_level: "6",
  finishing_level: "7",
  defense_level: "5",
  basketball_iq_level: "5",
  conditioning_level: "5",
  athleticism_level: "5",
  strength_level: "5",
};

// --- Unit rules --------------------------------------------------------------
assert(determineNextDifficulty(30, 40, 70) === "regress", "below target -> regress");
assert(determineNextDifficulty(55, 40, 70) === "repeat", "in target -> repeat");
assert(determineNextDifficulty(85, 40, 70) === "progress", "above target -> progress");

const painCats = detectPainExclusions(["my knee hurts after finishing drills"]);
assert(painCats.has("finishing") && painCats.has("conditioning"), "knee pain excludes leg-heavy categories");

// --- Initial block (no history) ----------------------------------------------
const emptyProfile = buildAdaptiveProfile(answers, []);
const composition = buildCompositionRules(45);

const initial = buildSmartPlan(clips, {
  startDayNumber: 1,
  blockIndex: 1,
  adaptiveProfile: emptyProfile,
  composition,
  daysPerWeek: 3,
  mainGoal: "improve shooting",
  hasCourtAccess: true,
  samples: [],
});

assert(initial.days.length === 5, "initial block has five days");
for (const day of initial.days) {
  assert(day.exercises.length > 0, `day ${day.day_number} has exercises`);
  const ids = day.exercises.map((e) => e.video_clip_id);
  assert(new Set(ids).size === ids.length, `day ${day.day_number} has no duplicate clips`);
  assert(
    day.exercises.some((e) => e.log_type === "makes_attempts" || e.log_type === "minutes"),
    `day ${day.day_number} has a measurable drill`
  );
  assert(
    day.exercises.filter((e) => e.category === "shooting").length >= 2,
    `day ${day.day_number} includes two shooting drills (hoop available)`
  );
  assert(
    day.estimated_minutes <= composition.minutes,
    `day ${day.day_number} fits the ${composition.minutes}-minute budget`
  );
}
const initialExercises = initial.days.flatMap((day) => day.exercises);
const scoredExercises = initialExercises.filter(
  (exercise) => exercise.category === "shooting" || exercise.category === "finishing"
);
assert(
  scoredExercises.every(
    (exercise) =>
      exercise.target_attempts != null &&
      exercise.target_makes != null &&
      exercise.target_attempts <= 60 &&
      exercise.target_makes >= Math.ceil(exercise.target_attempts * 0.5)
  ),
  "shooting targets stay at or below 60 attempts with at least 50% makes"
);
assert(
  initialExercises
    .filter((exercise) => exercise.category === "ball_handling")
    .every((exercise) => Number.parseInt(exercise.sets, 10) >= 2),
  "ball-handling drills prescribe at least two sets"
);
const timedExercises = initialExercises.filter((exercise) =>
  ["ball_handling", "defense", "conditioning"].includes(exercise.category)
);
assert(
  timedExercises.every((exercise) => {
    const minutes = Number.parseFloat(exercise.duration);
    return exercise.log_type === "minutes" && minutes >= 1 && minutes <= 3;
  }),
  "ball-handling, defense, and conditioning drills use one-to-three minute timed sets"
);
assert(
  initialExercises
    .filter((exercise) => exercise.set_side_labels != null)
    .every((exercise) => exercise.sets === "2" || exercise.sets === "4"),
  "bilateral drills prescribe two or four sets"
);
for (let i = 1; i < initial.days.length; i++) {
  const prev = new Set(initial.days[i - 1].exercises.map((e) => e.video_clip_id));
  const overlap = initial.days[i].exercises.filter((e) => prev.has(e.video_clip_id));
  assert(overlap.length === 0, `days ${i} and ${i + 1} share no consecutive drills`);
}

// Deficient days receive one-to-three stable random eligible drills, capped at
// the configured count.
const deficient = {
  ...initial,
  days: initial.days.map((day, index) => ({
    ...day,
    exercises: day.exercises.slice(0, day.exercises.length - [2, 1, 3, 2, 1][index]),
  })),
};
const allowedRepairPool = clips.filter((clip) => clip.difficulty_level !== "advanced");
const repairInput = {
  startDayNumber: 1,
  blockIndex: 1,
  randomSeed: "initial-user",
  adaptiveProfile: emptyProfile,
  composition,
  daysPerWeek: 3,
  mainGoal: "improve shooting",
  hasCourtAccess: true,
  samples: [] as PerformanceSample[],
};
const repairedDeficient = repairSmartPlan(deficient, allowedRepairPool, repairInput);
const repairedAgain = repairSmartPlan(deficient, allowedRepairPool, repairInput);
const allowedIds = new Set(allowedRepairPool.map((clip) => clip.id));
for (let index = 0; index < repairedDeficient.days.length; index++) {
  const before = deficient.days[index];
  const after = repairedDeficient.days[index];
  const increase = after.exercises.length - before.exercises.length;
  assert(
    increase >= 1 &&
      increase <= 3 &&
      after.exercises.length <= composition.totalExercises,
    `initial block day ${after.day_number} adds one-to-three drills without exceeding its configured count`
  );
  assert(
    new Set(after.exercises.map((exercise) => exercise.video_clip_id)).size ===
      after.exercises.length,
    `initial block day ${after.day_number} filler never duplicates a drill`
  );
  const originalIds = new Set(before.exercises.map((exercise) => exercise.video_clip_id));
  const addedIds = after.exercises
    .map((exercise) => exercise.video_clip_id)
    .filter((clipId) => !originalIds.has(clipId));
  assert(
    addedIds.every((clipId) => allowedIds.has(clipId)),
    `initial block day ${after.day_number} fillers stay inside the allowed difficulty pool`
  );
}
assert(
  JSON.stringify(
    repairedAgain.days.map((day) => day.exercises.map((exercise) => exercise.video_clip_id))
  ) ===
    JSON.stringify(
      repairedDeficient.days.map((day) =>
        day.exercises.map((exercise) => exercise.video_clip_id)
      )
    ),
  "deficient-day randomization is stable across retries"
);
const repairedFromReversedPool = repairSmartPlan(
  deficient,
  [...allowedRepairPool].reverse(),
  repairInput
);
assert(
  JSON.stringify(
    repairedFromReversedPool.days.map((day) =>
      day.exercises.map((exercise) => exercise.video_clip_id)
    )
  ) ===
    JSON.stringify(
      repairedDeficient.days.map((day) =>
        day.exercises.map((exercise) => exercise.video_clip_id)
      )
    ),
  "deficient-day selection is stable when catalog input order changes"
);

function stableHashForTest(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const seedRequestingThree = Array.from({ length: 100 }, (_, index) => `three-${index}`).find(
  (seed) => stableHashForTest(`${seed}:1:1:deficit-fill`) % 3 === 2
)!;
const threeMissing = {
  ...initial,
  days: initial.days.map((day, index) => ({
    ...day,
    exercises: index === 0 ? day.exercises.slice(0, day.exercises.length - 3) : day.exercises,
  })),
};
const threeAdded = repairSmartPlan(threeMissing, allowedRepairPool, {
  ...repairInput,
  randomSeed: seedRequestingThree,
});
assert(
  threeAdded.days[0].exercises.length - threeMissing.days[0].exercises.length === 3,
  "a randomized filler count of three adds three distinct exercises"
);

// --- Extension block with history ---------------------------------------------
// Simulate completing block 1 with mixed results.
const samples: PerformanceSample[] = [];
initial.days.forEach((day, dayIdx) => {
  day.exercises.forEach((exercise, exIdx) => {
    const good = exIdx % 3 !== 0;
    samples.push({
      dayNumber: day.day_number,
      category: exercise.category,
      videoClipId: exercise.video_clip_id,
      sets: exercise.sets,
      duration: exercise.duration,
      targetMakes: exercise.target_makes,
      targetAttempts: exercise.target_attempts,
      logType: exercise.log_type,
      completed: good,
      makes: exercise.target_makes != null ? (good ? exercise.target_makes : 1) : null,
      attempts: exercise.target_attempts,
      minutesCompleted: good ? 3 : null,
      difficulty: dayIdx === 0 && exIdx === 1 ? 5 : 3,
      prescribedDifficulty: "beginner",
      notes: exIdx === 2 && dayIdx === 4 ? "__hoop_set_logs__:" + JSON.stringify({ user_notes: "my knee hurts" }) : null,
    });
  });
});

const history = buildDrillHistory(samples);
assert(history.byClipId.size > 0, "history built from samples");
assert(history.baselineDrillIds.length > 0, "baseline drills identified");
assert(history.painExcludedCategories.size > 0, "pain exclusions detected from notes");

const profile2 = buildAdaptiveProfile(answers, samples);
const extend = buildSmartPlan(clips, {
  startDayNumber: 6,
  blockIndex: 2,
  adaptiveProfile: profile2,
  composition,
  daysPerWeek: 3,
  mainGoal: "improve shooting",
  hasCourtAccess: true,
  samples,
});

assert(extend.days.length === 5, "extension block has five days");
assert(extend.days[0].day_number === 6, "extension starts at day 6");

// Familiarity mix across the block.
const historyForMix = buildDrillHistory(samples);
const allExtendClips = extend.days.flatMap((d) => d.exercises);
const buckets = { familiar: 0, progressed: 0, new: 0 };
for (const exercise of allExtendClips) {
  const clip = clips.find((c) => c.id === exercise.video_clip_id)!;
  buckets[classifyClip(clip, historyForMix)]++;
}
const total = allExtendClips.length;
console.log(
  `mix: familiar ${Math.round((buckets.familiar / total) * 100)}%, progressed ${Math.round(
    (buckets.progressed / total) * 100
  )}%, new ${Math.round((buckets.new / total) * 100)}%`
);
assert(buckets.familiar / total >= 0.5, "at least half of extension drills are familiar");
assert(buckets.new / total <= 0.35, "new drills are bounded");

// Day 5 of the extension is the benchmark day.
const benchmark = extend.days[4];
assert(benchmark.title.includes("Benchmark"), "day 10 is a benchmark session");
const baselineInBenchmark = benchmark.exercises.filter((e) =>
  historyForMix.baselineDrillIds.includes(e.video_clip_id)
);
assert(baselineInBenchmark.length > 0, "benchmark day repeats baseline drills");

// First extension day must not repeat the last session of block 1.
const lastBlock1 = new Set(initial.days[4].exercises.map((e) => e.video_clip_id));
const firstExtend = extend.days[0].exercises.filter((e) => lastBlock1.has(e.video_clip_id));
assert(firstExtend.length === 0, "day 6 does not repeat day 5 drills");

// Pain exclusion respected in flexible slots (finishing may still appear as core).
for (const day of extend.days) {
  for (const exercise of day.exercises) {
    if (exercise.category === "conditioning") {
      assert(
        exercise.allocation_role === "core_required" || exercise.allocation_role === "warmup",
        `conditioning only appears in protected slots after knee pain (day ${day.day_number})`
      );
    }
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
