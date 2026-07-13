export const CATEGORY_DISPLAY_ORDER: Record<string, number> = {
  warmup: 0,
  mobility: 1,
  shooting: 2,
  ball_handling: 3,
  finishing: 4,
  footwork: 5,
  defense: 6,
  conditioning: 7,
  strength: 8,
  basketball_iq: 9,
};

export interface OrderedWorkoutExercise {
  category: string | null;
  order_index: number | null;
}

/** The category-grouped sequence shown on the Workouts screen. */
export function sortWorkoutExercisesForDisplay<T extends OrderedWorkoutExercise>(
  exercises: readonly T[]
): T[] {
  return [...exercises].sort((a, b) => {
    const categoryOrder =
      (CATEGORY_DISPLAY_ORDER[a.category ?? ""] ?? Number.MAX_SAFE_INTEGER) -
      (CATEGORY_DISPLAY_ORDER[b.category ?? ""] ?? Number.MAX_SAFE_INTEGER);
    return categoryOrder || (a.order_index ?? Number.MAX_SAFE_INTEGER) - (b.order_index ?? Number.MAX_SAFE_INTEGER);
  });
}
