import { buildWorkoutNavigation, type WorkoutContext } from "./coachCore.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextWithPartialShootingSet(): WorkoutContext {
  return {
    day: {
      id: "day",
      title: "Workout",
      focus: null,
      estimated_minutes: 45,
      coach_notes: null,
      completed: false,
      active_exercise_id: null,
    },
    exercises: [
      {
        id: "finish",
        order_index: 1,
        name: "Finishing",
        category: "finishing",
        instructions: null,
        sets: "2",
        reps: null,
        duration: null,
        target_makes: 8,
        target_attempts: 12,
        log_type: "makes_attempts",
      },
      {
        id: "shoot",
        order_index: 5,
        name: "Shooting",
        category: "shooting",
        instructions: null,
        sets: "2",
        reps: null,
        duration: null,
        target_makes: 8,
        target_attempts: 12,
        log_type: "makes_attempts",
      },
      {
        id: "warmup",
        order_index: 10,
        name: "Warmup",
        category: "warmup",
        instructions: null,
        sets: "1",
        reps: null,
        duration: null,
        target_makes: null,
        target_attempts: null,
        log_type: "checkbox",
      },
    ] as any,
    logs: new Map([
      ["warmup", { exercise_id: "warmup", completed: true, makes: null, attempts: null, minutes_completed: null, difficulty: null, notes: null }],
      [
        "shoot",
        {
          exercise_id: "shoot",
          completed: false,
          makes: 8,
          attempts: 12,
          minutes_completed: null,
          difficulty: null,
          notes: '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":8,"attempts":12,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}',
        },
      ],
    ]) as any,
  };
}

Deno.test("coach navigation uses the grouped Workouts order and the next unfinished set", () => {
  const navigation = buildWorkoutNavigation(contextWithPartialShootingSet());

  assert(navigation.drills[0].name === "Warmup", "warmup should be the first visible drill");
  assert(navigation.drills[1].name === "Shooting", "shooting should follow warmup by category");
  assert(navigation.next_work_item?.name === "Shooting", "current work should remain the shooting drill");
  assert(navigation.next_work_item?.set_number === 2, "current work should be shooting set two");
  assert(
    navigation.next_exercise_after_current?.name === "Finishing",
    "the following drill should be separate from the next work item"
  );
});

Deno.test("coach navigation honors an explicitly selected unfinished drill", () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  const navigation = buildWorkoutNavigation(ctx);

  assert(navigation.next_work_item?.name === "Finishing", "selected drill should become current");
  assert(
    navigation.next_work_item?.set_number === 1,
    "selected drill should start on its first unfinished set"
  );
  assert(
    navigation.drills.find((drill) => drill.name === "Shooting")?.status === "in_progress",
    "switching drills must not complete or skip the earlier drill"
  );
});
