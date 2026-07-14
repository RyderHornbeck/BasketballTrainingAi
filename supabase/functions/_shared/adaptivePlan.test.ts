import {
  buildAdaptiveProfile,
  buildCompositionRules,
  scorePerformanceSample,
} from "./adaptivePlan.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("short workouts use the five-drill adaptive mix", () => {
  const rules = buildCompositionRules(30);
  assert(rules.totalExercises === 5, "expected five exercises");
  assert(rules.warmups === 1, "expected one warmup");
  assert(rules.weaknessSlots === 2, "expected two weakness slots");
  assert(rules.strengthSlots === 1, "expected one strength slot");
  assert(rules.otherSlots === 1, "expected one other slot");
});

Deno.test("long workouts preserve six core drills before flexible allocation", () => {
  for (const minutes of [45, 60, 75, 90]) {
    const rules = buildCompositionRules(minutes);
    const allocated =
      rules.warmups + 6 + rules.weaknessSlots + rules.strengthSlots + rules.otherSlots;
    assert(allocated === rules.totalExercises, `${minutes}-minute allocation does not add up`);
  }
});

Deno.test("shooting performance rewards meeting targets", () => {
  const score = scorePerformanceSample({
    dayNumber: 1,
    category: "shooting",
    videoClipId: "clip",
    sets: "2",
    duration: null,
    targetMakes: 5,
    targetAttempts: 10,
    logType: "makes_attempts",
    completed: true,
    makes: 10,
    attempts: 20,
    minutesCompleted: null,
    difficulty: null,
    notes: null,
  });
  assert(score >= 90, "meeting a shooting target should score strongly");
});

Deno.test("sparse evidence stays anchored to onboarding", () => {
  const profile = buildAdaptiveProfile(
    {
      strengths: "shooting",
      weaknesses: "ball handling",
      shooting_level: "8",
      ball_handling_level: "3",
      finishing_level: "5",
      defense_level: "5",
      basketball_iq_level: "5",
      conditioning_level: "5",
      athleticism_level: "5",
      strength_level: "5",
    },
    []
  );
  assert(profile.strengths.includes("shooting"), "onboarding strength should seed profile");
  assert(
    profile.weaknesses.includes("ball_handling"),
    "onboarding weakness should seed profile"
  );
});

Deno.test("all explicitly selected weaknesses stay in the plan rotation", () => {
  const profile = buildAdaptiveProfile(
    {
      strengths: "basketball IQ",
      weaknesses: "Shooting, Ball handling, Finishing",
      shooting_level: "8",
      ball_handling_level: "8",
      finishing_level: "8",
      defense_level: "2",
      basketball_iq_level: "5",
      conditioning_level: "5",
      athleticism_level: "5",
      strength_level: "5",
    },
    []
  );

  for (const category of ["shooting", "ball_handling", "finishing"] as const) {
    assert(
      profile.weaknesses.includes(category),
      `${category} should remain an explicit weakness even when its self-rating is high`
    );
  }
});
