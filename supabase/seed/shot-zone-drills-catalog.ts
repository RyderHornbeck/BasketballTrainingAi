export interface ShotZoneCatalogDrill {
  exercise_name: string;
  category: "shooting";
  // These are fundamental location drills, available to every athlete tier.
  difficulty_level: null;
  description: string;
  coaching_notes: string;
  requires_both_sides: boolean;
}

export const SHOT_ZONE_DRILLS: ShotZoneCatalogDrill[] = [
  {
    exercise_name: "Corner 3 Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start in the right corner behind the three-point line. Step 1: Take 20 stationary corner threes, then repeat the same set from the left corner.",
    coaching_notes: "Set your feet, stay balanced, and hold your follow-through.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Wing 3 Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start on the right wing behind the three-point line. Step 1: Take 20 stationary wing threes, then repeat the same set from the left wing.",
    coaching_notes: "Square your feet and shoulders directly to the rim.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Top of Key 3 Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start at the top of the key behind the three-point line. Step 1: Take 20 stationary top-of-key threes.",
    coaching_notes: "Stay centered and finish straight through the rim.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Elbow Mid-Range Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start at the right elbow on the free-throw line. Step 1: Take 20 stationary mid-range jumpers, then repeat the same set from the left elbow.",
    coaching_notes: "Rise straight up and land in the same spot.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Wing Mid-Range Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start on the right wing inside the three-point line. Step 1: Take 20 stationary wing mid-range jumpers, then repeat the same set from the left wing.",
    coaching_notes: "Stay balanced and avoid drifting toward the sideline.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Center Mid-Range Spot-Up",
    category: "shooting",
    difficulty_level: null,
    description:
      "Start at the center of the free-throw line. Step 1: Take 20 stationary center mid-range jumpers.",
    coaching_notes: "Keep your elbow under the ball and hold your follow-through.",
    requires_both_sides: false,
  },
];
