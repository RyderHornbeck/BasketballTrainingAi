import {
  buildWorkoutNavigation,
  executeCoachTool,
  type WorkoutContext,
} from "./coachCore.ts";

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
  const shooting = navigation.drills.find((drill) => drill.name === "Shooting");
  assert(shooting?.set_results[0].makes === 8, "non-current drills expose exact set makes");
  assert(shooting?.set_results[0].attempts === 12, "non-current drills expose exact set attempts");
  assert(shooting?.set_results[0].misses === 4, "non-current drills expose exact set misses");
  assert(shooting?.set_results[0].completed === true, "non-current drills expose set completion");
  assert(shooting?.set_results[1].completed === false, "unfinished set state remains visible");
  assert(shooting?.target.makes === 8, "non-current drills expose their per-set target");
});

Deno.test("coach navigation exposes earlier unfinished drills after the final drill", () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  ctx.logs.set("finish", {
    exercise_id: "finish",
    completed: true,
    makes: 16,
    attempts: 24,
    minutes_completed: null,
    difficulty: null,
    notes:
      '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":8,"attempts":12,"minutes":null,"completed":true},{"set_number":2,"makes":8,"attempts":12,"minutes":null,"completed":true}]}',
  });

  const navigation = buildWorkoutNavigation(ctx);
  assert(navigation.workout_complete === false, "unfinished earlier drills keep workout open");
  assert(navigation.remaining_drills.length === 1, "only shooting should remain");
  assert(
    navigation.next_work_item?.name === "Shooting",
    "current work should wrap to the remaining earlier drill"
  );
});

function successfulSupabaseMock() {
  const query: Record<string, unknown> = {};
  query.update = () => query;
  query.upsert = () => query;
  query.eq = () => query;
  query.then = (
    resolve: (value: { error: null; data: null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve({ error: null, data: null }).then(resolve, reject);
  return {
    from: () => query,
  } as any;
}

function capturingSupabaseMock(rows: Record<string, unknown>[]) {
  const query: Record<string, unknown> = {};
  query.update = () => query;
  query.upsert = (row: Record<string, unknown>) => {
    rows.push(row);
    return query;
  };
  query.eq = () => query;
  query.then = (
    resolve: (value: { error: null; data: null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve({ error: null, data: null }).then(resolve, reject);
  return {
    from: () => query,
  } as any;
}

Deno.test("relative last drill overrides a conflicting guessed exercise ID", async () => {
  const ctx = contextWithPartialShootingSet();
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_drill",
    { exercise_id: "shoot", drill_name: "last drill" }
  );

  assert(outcome.dbChanged, "switch should succeed");
  assert(ctx.day.active_exercise_id === "finish", "spoken last drill must override guessed ID");
});

Deno.test("go back wraps to the nearest earlier unfinished drill", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_drill",
    { drill_name: "go back" }
  );

  assert(outcome.dbChanged, "go back should switch drills");
  assert(ctx.day.active_exercise_id === "shoot", "go back should select earlier unfinished shooting");
});

Deno.test("skipping a drill only changes the active position", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "shoot";
  const shootingLogBefore = ctx.logs.get("shoot");
  const writtenExerciseLogs: Record<string, unknown>[] = [];

  const outcome = await executeCoachTool(
    capturingSupabaseMock(writtenExerciseLogs),
    "user",
    "day",
    ctx,
    "skip_drill",
    { drill_name: "this drill" }
  );

  assert(outcome.dbChanged, "skip should move to another unfinished drill");
  assert(ctx.day.active_exercise_id === "finish", "skip should activate the next unfinished drill");
  assert(writtenExerciseLogs.length === 0, "skip must not write or complete an exercise log");
  assert(ctx.logs.get("shoot") === shootingLogBefore, "skip must preserve every existing set result");
  assert(shootingLogBefore?.makes === 8, "skip must not replace makes with the target");
  assert(shootingLogBefore?.completed === false, "skip must leave the drill incomplete");
});

Deno.test("reverse ordinal drill references use the full ordered workout", async () => {
  const ctx = contextWithPartialShootingSet();
  const shooting = ctx.exercises.find((exercise) => exercise.id === "shoot")!;
  ctx.exercises.push(
    ...[2, 3, 4, 5].map((number) => ({
      ...shooting,
      id: `shoot-${number}`,
      name: `Shooting ${number}`,
      order_index: 5 + number,
    }))
  );

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_drill",
    { drill_name: "move me to the 5th to last drill of the workout" }
  );

  assert(outcome.dbChanged, "fifth-to-last drill should resolve");
  assert(
    ctx.day.active_exercise_id === "shoot-2",
    "the resolver must count backward through the complete visible drill order"
  );
});

Deno.test("written reverse ordinals resolve like numeric reverse ordinals", async () => {
  const ctx = contextWithPartialShootingSet();
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_drill",
    { drill_name: "second from the end" }
  );

  assert(outcome.dbChanged, "written reverse ordinal should resolve");
  assert(ctx.day.active_exercise_id === "shoot", "second from end should select shooting");
});

Deno.test("timer without minutes uses the active timed set duration", async () => {
  const ctx = contextWithPartialShootingSet();
  const timedExercise = ctx.exercises.find((exercise) => exercise.id === "finish")!;
  timedExercise.category = "defense";
  timedExercise.log_type = "minutes";
  timedExercise.duration = "3 min";
  ctx.day.active_exercise_id = "finish";

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "start_timer",
    {}
  );

  assert(outcome.clientAction?.type === "start_timer", "timer should start for defense drills");
  assert(
    outcome.clientAction?.duration_seconds === 180,
    "timer must use the active set's three-minute duration, not workout estimate"
  );
  assert(outcome.clientAction?.timer_exercise_id === "finish", "timer must stay attached to active drill");
  assert(outcome.clientAction?.timer_set_number === 1, "timer must start on the active set");
});

Deno.test("timer without minutes never falls back to the workout duration", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "shoot";

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "start_timer",
    {}
  );

  assert(outcome.clientAction == null, "shooting drills must not start a workout-length timer");
  assert(
    outcome.result.includes("does not have a timed duration"),
    "coach should request a duration for untimed drills"
  );
});

Deno.test("sequential zero-make sets inherit the newly selected last drill", async () => {
  const ctx = contextWithPartialShootingSet();
  const rows: Record<string, unknown>[] = [];
  const supabase = capturingSupabaseMock(rows);

  await executeCoachTool(supabase, "user", "day", ctx, "set_current_drill", {
    drill_name: "last drill",
  });
  await executeCoachTool(supabase, "user", "day", ctx, "save_shooting_results", {
    set_number: 1,
    makes: 0,
  });
  const firstSet = rows[0];
  ctx.logs.set("finish", firstSet as any);
  await executeCoachTool(supabase, "user", "day", ctx, "save_shooting_results", {
    set_number: 2,
    makes: 0,
  });

  const final = rows[1];
  assert(final.exercise_id === "finish", "result calls must stay on the selected last drill");
  assert(final.makes === 0, "both zero-make sets should total zero makes");
  assert(final.attempts === 24, "omitted attempts should use the saved 12-attempt targets");
  assert(final.completed === true, "both reported sets should complete the drill");
});
