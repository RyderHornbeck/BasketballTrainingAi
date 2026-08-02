export const CATEGORY_DISPLAY_ORDER: Record<string, number> = {
  warmup: 0,
  mobility: 1,
  ball_handling: 2,
  shooting: 3,
  finishing: 4,
  defense: 5,
  conditioning: 6,
  footwork: 7,
  strength: 8,
  basketball_iq: 9,
};

export interface OrderedWorkoutExercise {
  category: string | null;
  order_index: number | null;
  name?: string | null;
}

function drillPriority(exercise: OrderedWorkoutExercise): number {
  const name = (exercise.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (exercise.category === "ball_handling") {
    if (
      /^(pound dribble|low pound dribble|right and left pounds|v dribble|half circle pound dribbles)$/
        .test(
          name,
        )
    ) {
      return 0;
    }
    return 1;
  }
  if (exercise.category === "shooting") {
    if (name === "form shooting") return 0;
    if (/\b(mid range|midrange)\b/.test(name)) return 1;
    if (/\b(?:3 (?:point|pt|spot|pointer)|three point)\b|\binto a 3\b/.test(name)) return 2;
    return 3;
  }
  return 0;
}

/** The category-grouped sequence shown on the Workouts screen. */
export function sortWorkoutExercisesForDisplay<
  T extends OrderedWorkoutExercise,
>(
  exercises: readonly T[],
): T[] {
  return [...exercises].sort((a, b) => {
    const categoryOrder =
      (CATEGORY_DISPLAY_ORDER[a.category ?? ""] ?? Number.MAX_SAFE_INTEGER) -
      (CATEGORY_DISPLAY_ORDER[b.category ?? ""] ?? Number.MAX_SAFE_INTEGER);
    return (
      categoryOrder ||
      drillPriority(a) - drillPriority(b) ||
      (a.order_index ?? Number.MAX_SAFE_INTEGER) -
        (b.order_index ?? Number.MAX_SAFE_INTEGER)
    );
  });
}
