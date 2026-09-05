import {
  isLocalWorkoutStructureChangeRequest,
  LOCAL_WORKOUT_STRUCTURE_CHANGE_REPLY,
} from "./coachRemovalIntent";

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

test("recognizes drill/exercise additions and removals locally", () => {
  const requests = [
    "Can you remove this drill?",
    "Hey Coach, please remove this exercise for me",
    "Could you delete the current drill?",
    "I want to get rid of that exercise",
    "Can you take this set out of my workout?",
    "Before we continue, can you remove this please?",
    "This drill, can you remove it?",
    "Can you add a form shooting drill?",
    "Add this exercise",
  ];

  for (const request of requests) {
    equal(isLocalWorkoutStructureChangeRequest(request), true, request);
  }
});

test("does not intercept unrelated timer and shooting changes", () => {
  const requests = [
    "Can you pause the timer?",
    "Remove five attempts from my total",
    "Can you explain this drill?",
    "Move me to the next set",
  ];

  for (const request of requests) {
    equal(isLocalWorkoutStructureChangeRequest(request), false, request);
  }
});

test("uses the required deterministic manual-edit response", () => {
  equal(
    LOCAL_WORKOUT_STRUCTURE_CHANGE_REPLY,
    "Coach cannot add or remove drills. It can only add sets to drills already in your workout. If you would like to add or remove something, you can manually edit your workout in the main app.",
    "local structure-change response",
  );
});
