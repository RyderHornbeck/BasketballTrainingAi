import {
  parseWorkoutEditorConstraints,
  validateWorkoutEditorOperations,
  workoutEditorCategoryScope,
  workoutEditorInformationRequest,
} from "./workoutEditorOperations.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("editor derives an exact removal count from a final drill target", () => {
  const constraints = parseWorkoutEditorConstraints("Delete 3 drills to get to 10 drills.", 13);
  assert(constraints.error === null, "consistent removal and target counts should be accepted");
  assert(constraints.removeCount === 3, "explicit removal count should be retained");
  assert(constraints.targetCount === 10, "final drill count should be retained");
});

Deno.test("editor rejects conflicting exact count requests before any edit", () => {
  const constraints = parseWorkoutEditorConstraints("Delete 2 drills to get to 10 drills.", 13);
  assert(constraints.error?.includes("11 drills"), "conflicting count request must explain mismatch");
});

Deno.test("editor derives exact adds or removals from a requested total", () => {
  const add = parseWorkoutEditorConstraints("Make it 8 drills total.", 5);
  const remove = parseWorkoutEditorConstraints("Make it 8 drills total.", 11);
  assert(add.addCount === 3 && add.removeCount === 0, "target above current should derive additions");
  assert(remove.addCount === 0 && remove.removeCount === 3, "target below current should derive removals");
});

Deno.test("editor recognizes workout-total wording with a workout subject", () => {
  const constraints = parseWorkoutEditorConstraints("Make my workout 6 exercises.", 12);
  assert(constraints.error === null, "workout-subject target should be accepted");
  assert(
    constraints.removeCount === 6 && constraints.targetCount === 6,
    "make my workout six exercises must deterministically require six removals",
  );
});

Deno.test("editor recognizes category-qualified shooting workout counts", () => {
  const direct = parseWorkoutEditorConstraints("Make the workout 6 shooting drills only.", 10);
  const natural = parseWorkoutEditorConstraints("I just want a 12 exercise shooting workout.", 6);
  assert(direct.targetCount === 6 && direct.removeCount === 4, "six shooting drills is a final count");
  assert(natural.targetCount === 12 && natural.addCount === 6, "shooting after exercises is a final count");
  assert(workoutEditorCategoryScope("Make the workout 6 shooting drills only.") === "shooting", "detect shooting-only scope");
});

Deno.test("editor routes count and list questions away from the model", () => {
  assert(workoutEditorInformationRequest("How many exercises are in my workout?") === "count", "count query");
  assert(workoutEditorInformationRequest("List them") === "list", "list query");
  assert(
    workoutEditorInformationRequest("Name every drill in this workout") === "list",
    "name every drill must bypass the model",
  );
  assert(
    workoutEditorInformationRequest("What are all the exercises in my workout?") === "list",
    "all-exercises query must bypass the model",
  );
  assert(workoutEditorInformationRequest("Add a shooting drill") === null, "edit is not information");
});

Deno.test("editor validates distinct exact operations without inventing drills", () => {
  const constraints = parseWorkoutEditorConstraints("Add 2 drills and remove one drill.", 5);
  const result = validateWorkoutEditorOperations(
    [
      { type: "add", clip_id: "a" },
      { type: "add", clip_id: "a" },
      { type: "remove", exercise_id: "one" },
    ],
    new Set(["a", "b"]),
    new Set(["one", "two", "three", "four", "five"]),
    new Map([
      ["one", "shooting"],
      ["two", "shooting"],
      ["three", "shooting"],
      ["four", "shooting"],
      ["five", "shooting"],
    ]),
    constraints,
  );
  assert(
    result.error?.includes("exactly 2 distinct drills to add"),
    "duplicate model IDs must not be counted as distinct additions",
  );
});

Deno.test("editor accepts exactly requested distinct drill operations", () => {
  const constraints = parseWorkoutEditorConstraints("Add 2 drills and remove one drill.", 5);
  const result = validateWorkoutEditorOperations(
    [
      { type: "add", clip_id: "a" },
      { type: "add", clip_id: "b" },
      { type: "remove", exercise_id: "one" },
      { type: "set_target", exercise_id: "two" },
    ],
    new Set(["a", "b", "c"]),
    new Set(["one", "two", "three", "four", "five"]),
    new Map([
      ["one", "shooting"],
      ["two", "shooting"],
      ["three", "shooting"],
      ["four", "shooting"],
      ["five", "shooting"],
    ]),
    constraints,
  );
  assert(result.error === null, "valid exact drill operations should be accepted");
  assert(result.operations.length === 3, "set-level operations must be ignored");
});

Deno.test("editor refuses to remove the final drill", () => {
  const constraints = parseWorkoutEditorConstraints("Remove 5 drills.", 5);
  assert(constraints.error?.includes("at most 4"), "one drill must remain in the workout");
});

Deno.test("editor permits reorder operations only within a drill category", () => {
  const result = validateWorkoutEditorOperations(
    [
      { type: "reorder", exercise_id: "midrange", position: 1 },
      { type: "reorder", exercise_id: "ball-handling", position: 1 },
    ],
    new Set(),
    new Set(["midrange", "ball-handling"]),
    new Map([
      ["midrange", "shooting"],
      ["ball-handling", "ball_handling"],
    ]),
    parseWorkoutEditorConstraints("Put the midrange drill first.", 2),
  );
  assert(result.error === null, "valid category-local reorders should be accepted");
  assert(result.operations.length === 2, "reorder operations should be preserved");
});

Deno.test("editor ignores duplicate positions within a category", () => {
  const result = validateWorkoutEditorOperations(
    [
      { type: "reorder", exercise_id: "one", position: 1 },
      { type: "reorder", exercise_id: "two", position: 1 },
    ],
    new Set(),
    new Set(["one", "two"]),
    new Map([
      ["one", "shooting"],
      ["two", "shooting"],
    ]),
    parseWorkoutEditorConstraints("Arrange the shooting drills.", 2),
  );
  assert(result.operations.length === 1, "one category position can have one requested move");
});
