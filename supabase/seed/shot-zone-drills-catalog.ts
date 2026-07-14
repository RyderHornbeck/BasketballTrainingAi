export type ShotZoneDifficulty = "beginner" | "intermediate" | "advanced";

export interface ShotZoneCatalogDrill {
  exercise_name: string;
  category: "shooting";
  difficulty_level: ShotZoneDifficulty;
  description: string;
  coaching_notes: string;
  requires_both_sides: boolean;
}

interface ShootingSpot {
  name: string;
  rightLocation: string;
  leftLocation?: string;
  shot: "three-pointer" | "mid-range jumper";
  coachingNote: string;
  requiresBothSides: boolean;
}

const SHOOTING_SPOTS: ShootingSpot[] = [
  {
    name: "Corner 3",
    rightLocation: "right corner behind the three-point line",
    leftLocation: "left corner behind the three-point line",
    shot: "three-pointer",
    coachingNote: "Keep your toes and shoulders square despite the tight baseline angle.",
    requiresBothSides: true,
  },
  {
    name: "Wing 3",
    rightLocation: "right wing behind the three-point line",
    leftLocation: "left wing behind the three-point line",
    shot: "three-pointer",
    coachingNote: "Point both feet toward the rim and avoid drifting toward the sideline.",
    requiresBothSides: true,
  },
  {
    name: "Top of Key 3",
    rightLocation: "top of the key behind the three-point line",
    shot: "three-pointer",
    coachingNote: "Stay centered behind the ball and finish straight through the rim.",
    requiresBothSides: false,
  },
  {
    name: "Elbow Mid-Range",
    rightLocation: "right elbow at the free-throw line",
    leftLocation: "left elbow at the free-throw line",
    shot: "mid-range jumper",
    coachingNote: "Stop on balance at the elbow and rise vertically.",
    requiresBothSides: true,
  },
  {
    name: "Center Free-Throw Mid-Range",
    rightLocation: "center of the free-throw line",
    shot: "mid-range jumper",
    coachingNote: "Keep your shooting elbow under the ball and hold the follow-through.",
    requiresBothSides: false,
  },
];

const LEVEL_INSTRUCTIONS: Record<
  ShotZoneDifficulty,
  { prefix: string; action: string; target: string; note: string }
> = {
  beginner: {
    prefix: "Beginner",
    action:
      "Spin the ball to yourself at the marked spot. Set both feet, bend your knees, and shoot without rushing.",
    target: "Take 20 shots from this one spot, resetting your feet before every attempt.",
    note: "Build identical foot placement and a repeatable release before adding speed.",
  },
  intermediate: {
    prefix: "Intermediate",
    action:
      "Spin the ball out, step into the catch with a one-two gather, and shoot immediately on balance.",
    target: "Take 20 game-speed shots from this one spot and track makes.",
    note: "Arrive low with hands ready so the catch flows directly into the shot.",
  },
  advanced: {
    prefix: "Advanced",
    action:
      "Sprint away from the spot, relocate back to it, catch on the move, set your feet quickly, and shoot.",
    target: "Take 20 game-speed shots from this one spot with no extra gather step.",
    note: "Create game pace before the catch while keeping the release balanced and repeatable.",
  },
};

/**
 * Fifteen text-only spot-up drills:
 * corner, wing, top-of-key, elbow, and center spots at every plan difficulty.
 * Bilateral spots use side-labelled sets, rather than separate left/right drills.
 */
export const SHOT_ZONE_DRILLS: ShotZoneCatalogDrill[] = (
  Object.keys(LEVEL_INSTRUCTIONS) as ShotZoneDifficulty[]
).flatMap((difficulty) => {
  const level = LEVEL_INSTRUCTIONS[difficulty];
  return SHOOTING_SPOTS.map((spot) => ({
    exercise_name: `${level.prefix} ${spot.name} Spot-Up`,
    category: "shooting" as const,
    difficulty_level: difficulty,
    description: spot.requiresBothSides
      ? `Start at the ${spot.rightLocation} with a basketball. Step 1: ${level.action} Step 2: Shoot the ${spot.shot} and hold your follow-through until the ball reaches the rim. Step 3: ${level.target} Complete the right-side set, then repeat every step from the ${spot.leftLocation} for the left-side set.`
      : `Start at the ${spot.rightLocation} with a basketball. Step 1: ${level.action} Step 2: Shoot the ${spot.shot} and hold your follow-through until the ball reaches the rim. Step 3: ${level.target}`,
    coaching_notes: `${spot.coachingNote} ${level.note}`,
    requires_both_sides: spot.requiresBothSides,
  }));
});
