export interface WorkoutEditorConstraints {
  addCount: number | null;
  removeCount: number | null;
  targetCount: number | null;
  error: string | null;
}

export interface WorkoutEditorOperation {
  type?: string;
  clip_id?: string;
  exercise_id?: string;
  position?: number;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
};

const COUNT_TOKEN = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)";
const CATEGORY_TOKEN = "(?:shooting|finishing|ball(?:\\s+|-)?handling|defen[cs]e|footwork|conditioning|strength|warmup|cooldown|mobility|basketball\\s+iq)";

function countFromMatch(match: RegExpExecArray | null): number | null {
  if (!match?.[1]) return null;
  const parsed = /^\d+$/.test(match[1])
    ? Number(match[1])
    : NUMBER_WORDS[match[1].toLowerCase()];
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

export function parseWorkoutEditorConstraints(
  message: string,
  currentCount: number,
): WorkoutEditorConstraints {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const addCount = countFromMatch(
    new RegExp(`\\b(?:add|include|insert)\\s+(?:another\\s+)?${COUNT_TOKEN}\\s+(?:more\\s+)?(?:drills?|exercises?)\\b`).exec(normalized),
  );
  const removeCount = countFromMatch(
    new RegExp(`\\b(?:remove|delete|drop)\\s+${COUNT_TOKEN}\\s+(?:more\\s+)?(?:drills?|exercises?)\\b`).exec(normalized),
  );
  const targetCount = countFromMatch(
    new RegExp(
      `\\b(?:to|get|make|have|reach|want|need)\\s+(?:(?:it|(?:my|the)\\s+workout|just)\\s+)?(?:have\\s+|to\\s+be\\s+)?(?:a\\s+)?${COUNT_TOKEN}\\s+(?:(?:${CATEGORY_TOKEN})\\s+)?(?:total\\s+)?(?:drills?|exercises?)(?:\\s+(?:${CATEGORY_TOKEN}))?(?:\\s+workout)?\\b`,
    ).exec(normalized),
  );

  if (targetCount != null && targetCount < 1) {
    return { addCount, removeCount, targetCount, error: "A workout must keep at least one drill." };
  }
  if (removeCount != null && removeCount > currentCount - 1) {
    return {
      addCount,
      removeCount,
      targetCount,
      error: `You can remove at most ${Math.max(0, currentCount - 1)} drills from this workout.`,
    };
  }

  const impliedTarget = currentCount + (addCount ?? 0) - (removeCount ?? 0);
  if (targetCount != null) {
    if ((addCount != null || removeCount != null) && impliedTarget !== targetCount) {
      return {
        addCount,
        removeCount,
        targetCount,
        error: `Those requested changes would result in ${impliedTarget} drills, not ${targetCount}.`,
      };
    }
    if (addCount == null && removeCount == null) {
      if (targetCount > currentCount) {
        return { addCount: targetCount - currentCount, removeCount: 0, targetCount, error: null };
      }
      if (targetCount < currentCount) {
        return { addCount: 0, removeCount: currentCount - targetCount, targetCount, error: null };
      }
      return { addCount: 0, removeCount: 0, targetCount, error: null };
    }
  }
  return { addCount, removeCount, targetCount, error: null };
}

export function workoutEditorCategoryScope(message: string): "shooting" | null {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /\bshooting\s+(?:drills?|exercises?|workout)\b/.test(normalized) ||
      /\b(?:drills?|exercises?)\s+shooting\s+workout\b/.test(normalized)
    ? "shooting"
    : null;
}

export function workoutEditorInformationRequest(
  message: string,
): "count" | "list" | null {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (
    /\b(?:how many|number of|count)\s+(?:drills?|exercises?)\b/.test(normalized) ||
    /\bhow many\s+(?:drills?|exercises?)\s+(?:are|do)\b/.test(normalized)
  ) {
    return "count";
  }
  if (
    /^(?:list|show|name|tell me|what are|which are)\s+(?:me\s+)?(?:every\s+|all\s+)?(?:the\s+)?(?:drills?|exercises?|workout)\b/.test(normalized) ||
    /\b(?:list|show|name)\s+(?:them|the drills|the exercises)\b/.test(normalized) ||
    /\b(?:every|all)\s+(?:drills?|exercises?)\s+(?:in|for)\s+(?:this|my|the)\s+workout\b/.test(normalized)
  ) {
    return "list";
  }
  return null;
}

export function validateWorkoutEditorOperations(
  operations: readonly WorkoutEditorOperation[],
  validClipIds: ReadonlySet<string>,
  validExerciseIds: ReadonlySet<string>,
  exerciseCategories: ReadonlyMap<string, string>,
  constraints: WorkoutEditorConstraints,
): { operations: WorkoutEditorOperation[]; error: string | null } {
  if (constraints.error) return { operations: [], error: constraints.error };
  const clipIds = new Set<string>();
  const exerciseIds = new Set<string>();
  const reorderExerciseIds = new Set<string>();
  const reorderPositionsByCategory = new Map<string, Set<number>>();
  for (const operation of operations) {
    if (operation.type === "add" && operation.clip_id && validClipIds.has(operation.clip_id)) {
      clipIds.add(operation.clip_id);
    }
    if (
      operation.type === "remove" &&
      operation.exercise_id &&
      validExerciseIds.has(operation.exercise_id)
    ) {
      exerciseIds.add(operation.exercise_id);
    }
    if (
      operation.type === "reorder" &&
      operation.exercise_id &&
      exerciseCategories.has(operation.exercise_id) &&
      Number.isInteger(operation.position) &&
      operation.position! > 0
    ) {
      const category = exerciseCategories.get(operation.exercise_id)!;
      const positions = reorderPositionsByCategory.get(category) ?? new Set<number>();
      if (!reorderExerciseIds.has(operation.exercise_id) && !positions.has(operation.position!)) {
        reorderExerciseIds.add(operation.exercise_id);
        positions.add(operation.position!);
        reorderPositionsByCategory.set(category, positions);
      }
    }
  }
  if (constraints.addCount != null && clipIds.size !== constraints.addCount) {
    return {
      operations: [],
      error: `I couldn't identify exactly ${constraints.addCount} distinct drills to add. Please be more specific.`,
    };
  }
  if (constraints.removeCount != null && exerciseIds.size !== constraints.removeCount) {
    return {
      operations: [],
      error: `I couldn't identify exactly ${constraints.removeCount} distinct drills to remove. Please name the drills or clarify.`,
    };
  }
  return {
    operations: [
      ...[...exerciseIds].map((exercise_id) => ({ type: "remove", exercise_id })),
      ...[...clipIds].map((clip_id) => ({ type: "add", clip_id })),
      ...operations.filter((operation) =>
        operation.type === "reorder" &&
        operation.exercise_id &&
        reorderExerciseIds.has(operation.exercise_id) &&
        Number.isInteger(operation.position) &&
        operation.position! > 0
      ),
    ],
    error: null,
  };
}
