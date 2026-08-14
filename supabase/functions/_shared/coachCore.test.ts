import {
  buildCoachTurnDynamicContext,
  buildCompactContextSummary,
  buildRealtimeModelContext,
  buildRealtimeNavigationUpdate,
  buildRealtimeSessionConfig,
  buildWorkoutDrillListSummary,
  buildWorkoutNavigation,
  COACH_SYSTEM_PROMPT,
  COACH_TURN_STABLE_SYSTEM_PROMPT,
  executeCoachTool,
  getRealtimeTools,
  rankCatalogExercises,
  type WorkoutContext,
} from "./coachCore.ts";
import { decodeExerciseLogMeta } from "./exerciseSetLogs.ts";

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
        set_side_labels: ["left side", "right side"],
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
      ["warmup", {
        exercise_id: "warmup",
        completed: true,
        makes: null,
        attempts: null,
        minutes_completed: null,
        difficulty: null,
        notes: null,
      }],
      [
        "shoot",
        {
          exercise_id: "shoot",
          completed: false,
          makes: 8,
          attempts: 12,
          minutes_completed: null,
          difficulty: null,
          notes:
            '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":8,"attempts":12,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}',
        },
      ],
    ]) as any,
  };
}

Deno.test("coach navigation uses the grouped Workouts order and the next unfinished set", () => {
  const navigation = buildWorkoutNavigation(contextWithPartialShootingSet());

  assert(
    navigation.drills[0].name === "Warmup",
    "warmup should be the first visible drill",
  );
  assert(
    navigation.drills[1].name === "Shooting",
    "shooting should follow warmup by category",
  );
  assert(
    navigation.next_work_item?.name === "Shooting",
    "current work should remain the shooting drill",
  );
  assert(
    navigation.next_work_item?.set_number === 2,
    "current work should be shooting set two",
  );
  assert(
    navigation.next_work_item?.set_side_label === "right side",
    "the current set should expose its assigned side",
  );
  assert(
    navigation.drills[1].set_results[0].side_label === "left side" &&
      navigation.drills[1].set_results[1].side_label === "right side",
    "every set should expose its exact side label",
  );
  assert(
    navigation.current_set_state?.progress.makes === 0 &&
      navigation.current_set_state.progress.attempts === 0,
    "an untouched set must expose zero actual progress, not its prescribed attempts",
  );
  assert(
    navigation.current_set_state?.target.makes === 8 &&
      navigation.current_set_state.target.attempts === 12,
    "the current set must expose its prescribed target separately",
  );
  assert(
    navigation.current_set_state?.remaining.makes === 8 &&
      navigation.current_set_state.remaining.attempts === 12,
    "the current set must expose precomputed remaining work",
  );
  assert(
    navigation.next_exercise_after_current?.name === "Finishing",
    "the following drill should be separate from the next work item",
  );
});

Deno.test("an explicitly selected incomplete set remains the current Coach position", () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  ctx.day.active_set_number = 2;

  const navigation = buildWorkoutNavigation(ctx);
  assert(
    navigation.next_work_item?.name === "Finishing" &&
      navigation.next_work_item?.set_number === 2,
    "an active incomplete set must override an earlier unfinished set",
  );
});

Deno.test("shooting drill lists exclude the separate finishing category", () => {
  const summary = buildWorkoutDrillListSummary(
    contextWithPartialShootingSet(),
    "shooting",
  );
  assert(
    summary.includes("Shooting"),
    "shooting category drills should be listed",
  );
  assert(
    !summary.includes("Finishing"),
    "finishing must not be treated as a shooting drill",
  );
});

Deno.test("current shooting progress never replaces the prescribed set target", () => {
  const ctx = contextWithPartialShootingSet();
  const shootingLog = ctx.logs.get("shoot");
  assert(shootingLog, "shooting log fixture is required");
  shootingLog.notes =
    '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":2,"attempts":3,"minutes":null,"completed":false},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}],"per_set_attempts_override":3}';

  const current = buildWorkoutNavigation(ctx).current_set_state;
  assert(
    current?.progress.makes === 2 && current.progress.attempts === 3,
    "progress must describe only shots already taken",
  );
  assert(
    current?.target.makes === 8 && current.target.attempts === 12,
    "the workout exercise target must remain authoritative over legacy progress metadata",
  );
  assert(
    current?.remaining.makes === 6 && current.remaining.attempts === 9,
    "remaining work must be calculated from target minus progress",
  );
});

Deno.test("coach navigation honors an explicitly selected unfinished drill", () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  const navigation = buildWorkoutNavigation(ctx);

  assert(
    navigation.next_work_item?.name === "Finishing",
    "selected drill should become current",
  );
  assert(
    navigation.next_work_item?.set_number === 1,
    "selected drill should start on its first unfinished set",
  );
  assert(
    navigation.drills.find((drill) => drill.name === "Shooting")?.status ===
      "in_progress",
    "switching drills must not complete or skip the earlier drill",
  );
  const shooting = navigation.drills.find((drill) => drill.name === "Shooting");
  assert(
    shooting?.set_results[0].makes === 8,
    "non-current drills expose exact set makes",
  );
  assert(
    shooting?.set_results[0].attempts === 12,
    "non-current drills expose exact set attempts",
  );
  assert(
    shooting?.set_results[0].misses === 4,
    "non-current drills expose exact set misses",
  );
  assert(
    shooting?.set_results[0].completed === true,
    "non-current drills expose set completion",
  );
  assert(
    shooting?.set_results[1].completed === false,
    "unfinished set state remains visible",
  );
  assert(
    shooting?.target.makes === 8,
    "non-current drills expose their per-set target",
  );
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
  assert(
    navigation.workout_complete === false,
    "unfinished earlier drills keep workout open",
  );
  assert(
    navigation.remaining_drills.length === 1,
    "only shooting should remain",
  );
  assert(
    navigation.next_work_item?.name === "Shooting",
    "current work should wrap to the remaining earlier drill",
  );
});

function successfulSupabaseMock() {
  const query: Record<string, unknown> = {};
  query.update = () => query;
  query.upsert = () => query;
  query.delete = () => query;
  query.eq = () => query;
  query.then = (
    resolve: (value: { error: null; data: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ error: null, data: null }).then(resolve, reject);
  return {
    from: () => query,
  } as any;
}

function capturingSupabaseMock(rows: Record<string, unknown>[]) {
  const query: Record<string, unknown> = {};
  query.update = () => query;
  query.delete = () => query;
  query.upsert = (row: Record<string, unknown>) => {
    rows.push(row);
    return query;
  };
  query.eq = () => query;
  query.then = (
    resolve: (value: { error: null; data: null }) => unknown,
    reject?: (reason: unknown) => unknown,
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
    { exercise_id: "shoot", drill_name: "last drill" },
  );

  assert(outcome.dbChanged, "switch should succeed");
  assert(
    ctx.day.active_exercise_id === "finish",
    "spoken last drill must override guessed ID",
  );
});

Deno.test("set_current_position selects an incomplete set without completing it", async () => {
  const ctx = contextWithPartialShootingSet();
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_position",
    { drill_name: "Finishing", set_number: 2 },
  );

  assert(outcome.dbChanged, "position selection should persist");
  assert(
    ctx.day.active_exercise_id === "finish" && ctx.day.active_set_number === 2,
    "the selected drill and set should become the authoritative position",
  );
  assert(
    !ctx.logs.get("finish")?.completed,
    "position selection must not complete the skipped set",
  );
});

Deno.test("set_current_position moves from an incomplete first set to set two without completion", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "finish";
  ctx.day.active_set_number = 1;
  const writtenExerciseLogs: Record<string, unknown>[] = [];

  const outcome = await executeCoachTool(
    capturingSupabaseMock(writtenExerciseLogs),
    "user",
    "day",
    ctx,
    "set_current_position",
    { drill_name: "Finishing", set_number: 2 },
  );

  assert(outcome.dbChanged, "moving to set two should persist the position");
  assert(
    ctx.day.active_exercise_id === "finish" && ctx.day.active_set_number === 2,
    "the second set should become active even when set one is incomplete",
  );
  assert(
    writtenExerciseLogs.length === 0 && !ctx.logs.get("finish")?.completed,
    "set navigation must not record or complete the drill",
  );
});

Deno.test("set_current_position defaults a drill move to its next incomplete set", async () => {
  const ctx = contextWithPartialShootingSet();
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_position",
    { drill_name: "Shooting" },
  );

  assert(outcome.dbChanged, "drill navigation should persist");
  assert(
    ctx.day.active_exercise_id === "shoot" && ctx.day.active_set_number === 2,
    "moving to a drill without a set must select its next incomplete set",
  );
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
    { drill_name: "go back" },
  );

  assert(outcome.dbChanged, "go back should switch drills");
  assert(
    ctx.day.active_exercise_id === "shoot",
    "go back should select earlier unfinished shooting",
  );
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
    { drill_name: "this drill" },
  );

  assert(outcome.dbChanged, "skip should move to another unfinished drill");
  assert(
    ctx.day.active_exercise_id === "finish",
    "skip should activate the next unfinished drill",
  );
  assert(
    writtenExerciseLogs.length === 0,
    "skip must not write or complete an exercise log",
  );
  assert(
    ctx.logs.get("shoot") === shootingLogBefore,
    "skip must preserve every existing set result",
  );
  assert(
    shootingLogBefore?.makes === 8,
    "skip must not replace makes with the target",
  );
  assert(
    shootingLogBefore?.completed === false,
    "skip must leave the drill incomplete",
  );
});

Deno.test("reopening a completed set preserves its recorded numbers", async () => {
  const ctx = contextWithPartialShootingSet();
  const rows: Record<string, unknown>[] = [];
  const outcome = await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    ctx,
    "set_set_completion",
    {
      exercise_id: "shoot",
      drill_name: "Shooting",
      set_number: 1,
      completed: false,
    },
  );

  const meta = decodeExerciseLogMeta(String(rows[0]?.notes ?? ""));
  const reopened = meta.set_logs?.find((set) => set.set_number === 1);
  assert(outcome.dbChanged, "reopening should save the set");
  assert(
    reopened?.completed === false,
    "the selected set should be incomplete",
  );
  assert(
    reopened?.force_incomplete === true,
    "reopening should override automatic completion",
  );
  assert(
    reopened?.makes === 8 && reopened.attempts === 12,
    "reopening must preserve the saved makes and attempts",
  );
});

Deno.test("incomplete finishing completion requires confirmation before marking the set done", async () => {
  const ctx = contextWithPartialShootingSet();
  const rows: Record<string, unknown>[] = [];
  const firstOutcome = await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    ctx,
    "set_set_completion",
    {
      exercise_id: "finish",
      drill_name: "Finishing",
      set_number: 1,
      completed: true,
    },
  );

  assert(!firstOutcome.dbChanged, "incomplete shooting work must not complete immediately");
  assert(rows.length === 0, "the confirmation prompt must not write a result");
  assert(
    firstOutcome.result.includes("Would you like to start this set or mark it complete as is?"),
    "Coach should offer the athlete an explicit completion choice",
  );

  const outcome = await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    ctx,
    "set_set_completion",
    {
      exercise_id: "finish",
      drill_name: "Finishing",
      set_number: 1,
      completed: true,
      confirmed_incomplete: true,
    },
  );
  const meta = decodeExerciseLogMeta(String(rows[0]?.notes ?? ""));
  const completed = meta.set_logs?.find((set) => set.set_number === 1);
  assert(outcome.dbChanged, "the confirmed completion request must complete the set");
  assert(completed?.completed === true, "the selected set must be marked complete");
});

Deno.test("reopening a whole drill preserves every recorded result", async () => {
  const ctx = contextWithPartialShootingSet();
  const shootingLog = ctx.logs.get("shoot");
  assert(shootingLog, "shooting log fixture is required");
  shootingLog.completed = true;
  const rows: Record<string, unknown>[] = [];
  const outcome = await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    ctx,
    "uncomplete_drill",
    { exercise_id: "shoot" },
  );

  const meta = decodeExerciseLogMeta(String(rows[0]?.notes ?? ""));
  const firstSet = meta.set_logs?.find((set) => set.set_number === 1);
  assert(outcome.dbChanged, "whole-drill reopening should persist");
  assert(
    rows[0]?.makes === 8 && rows[0]?.attempts === 12,
    "aggregate shooting history must remain unchanged",
  );
  assert(
    firstSet?.makes === 8 &&
      firstSet.attempts === 12 &&
      firstSet.completed === false &&
      firstSet.force_incomplete === true,
    "set results must be preserved while reopening completion",
  );
});

Deno.test("reopen_workout executes without resetting drill history", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.completed = true;
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "reopen_workout",
    {},
  );

  assert(outcome.dbChanged, "registered reopen_workout should execute");
  assert(ctx.day.completed === false, "the workout day should be open");
  assert(
    ctx.logs.get("shoot")?.attempts === 12,
    "reopening the workout must preserve drill history",
  );
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
    })),
  );

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "set_current_drill",
    { drill_name: "move me to the 5th to last drill of the workout" },
  );

  assert(outcome.dbChanged, "fifth-to-last drill should resolve");
  assert(
    ctx.day.active_exercise_id === "shoot-2",
    "the resolver must count backward through the complete visible drill order",
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
    { drill_name: "second from the end" },
  );

  assert(outcome.dbChanged, "written reverse ordinal should resolve");
  assert(
    ctx.day.active_exercise_id === "shoot",
    "second from end should select shooting",
  );
});

Deno.test("timer without minutes uses the active timed set duration", async () => {
  const ctx = contextWithPartialShootingSet();
  const timedExercise = ctx.exercises.find((exercise) =>
    exercise.id === "finish"
  )!;
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
    {},
  );

  assert(
    outcome.clientAction?.type === "start_timer",
    "timer should start for defense drills",
  );
  assert(
    outcome.clientAction?.duration_seconds === 180,
    "timer must use the active set's three-minute duration, not workout estimate",
  );
  assert(
    outcome.result === "A 3-minute timer has been started.",
    "every started timer must announce its duration",
  );
  assert(
    outcome.clientAction?.timer_exercise_id === "finish",
    "timer must stay attached to active drill",
  );
  assert(
    outcome.clientAction?.timer_set_number === 1,
    "timer must start on the active set",
  );
});

Deno.test("shooting sets cannot start timers", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "shoot";

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "start_timer",
    { minutes: 2 },
  );

  assert(
    outcome.clientAction == null &&
      outcome.result === "That set does not use timed sets, so I won't start a timer.",
    "shooting sets must reject timer starts even when a duration is requested",
  );
});

Deno.test("second-based timer requests stay in seconds", async () => {
  const ctx = contextWithPartialShootingSet();
  const timedExercise = ctx.exercises.find((exercise) =>
    exercise.id === "finish"
  )!;
  timedExercise.category = "conditioning";
  timedExercise.log_type = "minutes";
  timedExercise.duration = "2 minutes";
  ctx.day.active_exercise_id = timedExercise.id;

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "start_timer",
    { seconds: 30 },
  );

  assert(
    outcome.clientAction?.duration_seconds === 30,
    "30 seconds must not become 30 minutes",
  );
  assert(
    outcome.result === "A 30-second timer has been started.",
    "the timer announcement must preserve seconds",
  );
  assert(
    outcome.clientAction?.timer_exercise_id === timedExercise.id &&
      outcome.clientAction?.timer_set_number === 1,
    "a second-based timer must remain bound to the timed set it will complete",
  );
});

Deno.test("coach can change a timed drill to thirty-second sets", async () => {
  const ctx = contextWithPartialShootingSet();
  const timedExercise = ctx.exercises.find((exercise) =>
    exercise.id === "finish"
  )!;
  timedExercise.name = "Pound Dribble";
  timedExercise.category = "ball_handling";
  timedExercise.log_type = "minutes";
  timedExercise.duration = "2 min";
  timedExercise.target_makes = null;
  timedExercise.target_attempts = null;
  ctx.day.active_exercise_id = "finish";
  const rows: Record<string, unknown>[] = [];
  const supabase = capturingSupabaseMock(rows);

  const changed = await executeCoachTool(
    supabase,
    "user",
    "day",
    ctx,
    "set_timed_set_duration",
    { drill_name: "Pound Dribble", duration_seconds: 30 },
  );
  const meta = decodeExerciseLogMeta(String(rows[0]?.notes ?? ""));
  assert(changed.dbChanged, "set-duration change should persist");
  assert(
    meta.set_logs?.[0].duration_seconds_override === 30 &&
      meta.set_logs?.[1].duration_seconds_override == null,
    "thirty seconds should be stored only on the selected set",
  );
  const current = buildWorkoutNavigation(ctx).current_set_state;
  assert(
    current?.target.minutes === 0.5,
    "realtime context should expose the selected set's saved duration",
  );

  const timer = await executeCoachTool(
    supabase,
    "user",
    "day",
    ctx,
    "start_timer",
    {},
  );
  assert(
    timer.clientAction?.duration_seconds === 30,
    "the default set timer should immediately use the changed duration",
  );
  assert(
    timer.result === "A 30-second timer has been started.",
    "a changed sub-minute set timer must announce seconds",
  );
});

Deno.test("coach changes one shooting set target without changing results", async () => {
  const ctx = contextWithPartialShootingSet();
  ctx.day.active_exercise_id = "shoot";
  const rows: Record<string, unknown>[] = [];
  const supabase = capturingSupabaseMock(rows);

  const outcome = await executeCoachTool(
    supabase,
    "user",
    "day",
    ctx,
    "set_shooting_set_targets",
    {
      exercise_id: "shoot",
      set_number: 2,
      target_makes: 10,
      target_attempts: 15,
    },
  );

  const meta = decodeExerciseLogMeta(String(rows[0]?.notes ?? ""));
  const changedSet = meta.set_logs?.find((set) => set.set_number === 2);
  assert(outcome.dbChanged, "target change should persist");
  assert(
    changedSet?.target_makes_override === 10 &&
      changedSet.target_attempts_override === 15,
    "the selected set should store both target overrides",
  );
  assert(
    meta.set_logs?.[0].makes === 8 && meta.set_logs?.[0].attempts === 12,
    "existing results must remain unchanged",
  );
  assert(
    changedSet?.makes == null && changedSet?.attempts == null,
    "changing an untouched set target must not create fake shot results",
  );

  const drill = buildWorkoutNavigation(ctx).drills.find(
    (entry) => entry.exercise_id === "shoot",
  );
  const contextSet = drill?.set_results.find((set) => set.set_number === 2);
  assert(
    contextSet?.target.makes === 10 && contextSet.target.attempts === 15,
    "realtime context should expose the selected set's new targets",
  );
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
    {},
  );

  assert(
    outcome.clientAction == null,
    "shooting drills must not start a workout-length timer",
  );
  assert(
    outcome.result.includes("does not have a timed duration"),
    "coach should request a duration for untimed drills",
  );
});

Deno.test("sequential zero-make sets inherit the newly selected last drill", async () => {
  const ctx = contextWithPartialShootingSet();
  const rows: Record<string, unknown>[] = [];
  const supabase = capturingSupabaseMock(rows);

  await executeCoachTool(supabase, "user", "day", ctx, "set_current_drill", {
    drill_name: "last drill",
  });
  await executeCoachTool(
    supabase,
    "user",
    "day",
    ctx,
    "save_shooting_results",
    {
      set_number: 1,
      makes: 0,
    },
  );
  const firstSet = rows[0];
  ctx.logs.set("finish", firstSet as any);
  await executeCoachTool(
    supabase,
    "user",
    "day",
    ctx,
    "save_shooting_results",
    {
      set_number: 2,
      makes: 0,
    },
  );

  const final = rows[1];
  assert(
    final.exercise_id === "finish",
    "result calls must stay on the selected last drill",
  );
  assert(final.makes === 0, "both zero-make sets should total zero makes");
  assert(
    final.attempts === 24,
    "omitted attempts should use the saved 12-attempt targets",
  );
  assert(
    final.completed === true,
    "both reported sets should complete the drill",
  );
});

Deno.test("shooting context labels results far below the makes target", () => {
  const ctx = contextWithPartialShootingSet();
  const shootingLog = ctx.logs.get("shoot")!;
  shootingLog.completed = true;
  shootingLog.makes = 1;
  shootingLog.attempts = 20;
  shootingLog.notes =
    '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":1,"attempts":10,"minutes":null,"completed":true},{"set_number":2,"makes":0,"attempts":10,"minutes":null,"completed":true}]}';

  const summary = JSON.parse(buildCompactContextSummary(ctx, null, undefined));
  const shooting = summary.sequence.drills.find((
    drill: { exercise_id: string },
  ) => drill.exercise_id === "shoot");

  assert(
    shooting.set_results[0].target_comparison.status ===
      "significantly_below_target",
    "one make against an eight-make target must be identified as significantly below target",
  );
  assert(
    shooting.set_results[0].target_comparison.makes_below_target ===
      shooting.target.makes - shooting.set_results[0].makes,
    "context should expose the exact target gap",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes(
      "never agree that a below-target result is good",
    ),
    "the coach must not validate a below-target result as good",
  );
});

Deno.test("workout kickoff asks Haiku to report the current drill without tools", () => {
  assert(
    COACH_SYSTEM_PROMPT.includes(
      '"Let\'s start this workout," "start the workout," or equivalent kickoff language is a read-only request',
    ) &&
      COACH_SYSTEM_PROMPT.includes(
        "Without calling any tool or changing state, state the current drill and set",
      ),
    "workout kickoff must be a context-only response rather than a tool action",
  );
});

Deno.test("timed drills require the live-status tool for direct timer questions", () => {
  assert(
    COACH_SYSTEM_PROMPT.includes(
      'ask: "Would you like me to start the [X]-minute set timer?"',
    ) &&
      COACH_SYSTEM_PROMPT.includes(
        "Never ask or offer timers for shooting/finishing",
      ) &&
      COACH_SYSTEM_PROMPT.includes("ALWAYS call get_timer_status"),
    "timer offers and direct status questions must use the live-status tool",
  );
});

Deno.test("model context never includes live timer state", () => {
  const ctx = contextWithPartialShootingSet();
  const noTimer = JSON.parse(buildRealtimeModelContext(ctx, null, {
    running: false,
    elapsed_seconds: 0,
  }));
  assert(
    !("timer_status" in noTimer) && !("timer" in noTimer),
    "live timer state must be retrieved only through get_timer_status",
  );
});

Deno.test("normalized realtime context preserves coach knowledge with less duplication", () => {
  const ctx = contextWithPartialShootingSet();
  const legacy = buildCompactContextSummary(ctx, {
    main_goal: "Improve shooting",
  }, undefined);
  const compact = buildRealtimeModelContext(ctx, {
    main_goal: "Improve shooting",
  }, undefined);
  const parsed = JSON.parse(compact);
  const shooting = parsed.drills.find(
    (drill: { exercise_id: string }) => drill.exercise_id === "shoot",
  );

  assert(
    shooting.name === "Shooting",
    "compact state must preserve drill identity",
  );
  assert(shooting.sets.total === 2, "compact state must preserve set count");
  assert(
    shooting.set_results[0].makes === 8,
    "compact state must preserve actual makes",
  );
  assert(
    shooting.set_results[0].attempts === 12,
    "compact state must preserve actual attempts",
  );
  assert(
    shooting.set_results[0].side_label === "left side",
    "set sides must be preserved",
  );
  assert(
    shooting.target_per_set.makes === 8,
    "per-set makes target must be preserved",
  );
  assert(
    shooting.target_per_set.attempts === 12,
    "per-set attempts target must be preserved",
  );
  assert(
    parsed.current_set.set_number === 2,
    "authoritative current set must be preserved",
  );
  assert(
    parsed.next_exercise.name === "Finishing",
    "next exercise must be preserved",
  );
  assert(
    parsed.totals.makes === 8 && parsed.totals.attempts === 12,
    "totals must be preserved",
  );
  assert(
    compact.length < legacy.length * 0.72,
    "model state should be at least 28% smaller",
  );

  const update = JSON.parse(buildRealtimeNavigationUpdate(ctx));
  assert(
    update.current_set.set_number === 2,
    "state deltas must preserve the current set",
  );
  assert(update.drills.length === 3, "state deltas must preserve every drill");
  assert(
    !("sequence" in update),
    "state deltas must not repeat the legacy expanded sequence",
  );

  const changed = contextWithPartialShootingSet();
  changed.logs.set("shoot", {
    ...changed.logs.get("shoot")!,
    makes: 10,
    attempts: 15,
    notes:
      '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":8,"attempts":12,"minutes":null,"completed":true},{"set_number":2,"makes":2,"attempts":3,"minutes":null,"completed":false}]}',
  });
  const delta = JSON.parse(buildRealtimeNavigationUpdate(changed, ctx));
  assert(
    delta.state_scope === "delta",
    "mutation updates must identify themselves as deltas",
  );
  assert(
    delta.drills.length === 1 && delta.drills[0].exercise_id === "shoot",
    "mutation updates should repeat only changed drill state",
  );
  assert(
    delta.current_set.progress.attempts === 3,
    "delta navigation must contain fresh progress",
  );
});

Deno.test("coach turn prompt separates cached policy from bounded dynamic state", () => {
  const ctx = contextWithPartialShootingSet();
  const dynamic = buildCoachTurnDynamicContext(
    ctx,
    { main_goal: "Improve shooting" },
    `User: ${"x".repeat(1_500)}`,
    "Coach Maya",
    undefined,
    true,
  );
  const parsed = JSON.parse(dynamic.slice(dynamic.indexOf("{")));

  assert(
    COACH_TURN_STABLE_SYSTEM_PROMPT.includes("Never mention a query"),
    "stable policy must prevent internal implementation language",
  );
  assert(
    !dynamic.includes(COACH_SYSTEM_PROMPT),
    "dynamic state must not duplicate the stable policy",
  );
  assert(
    !dynamic.includes("Request mode:"),
    "dynamic state must not expose internal request modes",
  );
  assert(
    parsed.recent_conversation.length === 800,
    "dynamic conversation history should be tightly bounded",
  );
  const conversational = buildCoachTurnDynamicContext(
    ctx,
    null,
    null,
    "Coach Maya",
    undefined,
    false,
    false,
  );
  assert(
    !conversational.includes("Authoritative workout state"),
    "confidently conversational turns should omit unused workout state",
  );
});

Deno.test("saved shooting results report target status and add requires confirmation", async () => {
  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    contextWithPartialShootingSet(),
    "save_shooting_results",
    { drill_name: "Shooting", set_number: 2, makes: 1, attempts: 10 },
  );
  const addTool = getRealtimeTools().find((tool) =>
    tool.name === "add_workout_exercise"
  );

  assert(
    outcome.result.includes("below target and needs work"),
    "low results must be explicit",
  );
  assert(
    outcome.result.includes("Target:"),
    "saved result should include the authoritative target",
  );
  assert(
    outcome.result.includes("1 for 10"),
    "shooting results must always use the word for",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes('Never say "X slash Y," "X over Y,"'),
    "the realtime coach must never pronounce shooting results as slash or over",
  );
  assert(
    addTool?.description.includes("only after the athlete confirms"),
    "adding a drill must require confirmation",
  );
  assert(
    addTool?.parameters.required?.includes("exercise_name") &&
      !addTool.parameters.required?.includes("catalog_exercise_id"),
    "catalog additions should use the selected drill name rather than asking for an internal ID",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes("requires confirmation before mutation"),
    "an absent requested drill or change must be confirmed before editing",
  );
  assert(
    COACH_TURN_STABLE_SYSTEM_PROMPT.includes(
      "search the catalog before offering to add the closest match",
    ),
    "unlisted drill requests must search before the add offer",
  );
  assert(
    COACH_TURN_STABLE_SYSTEM_PROMPT.includes(
      "You can start, pause, resume, and stop timers.",
    ),
    "the model must know it can control timers through its tool contract",
  );
  assert(
    COACH_TURN_STABLE_SYSTEM_PROMPT.includes(
      "Exact make, miss, and incremental shooting commands are handled before a turn reaches you.",
    ),
    "the server model must not be instructed to call client-only shot tools",
  );
});

Deno.test("saving a set keeps guidance on the same drill while another set remains", async () => {
  const ctx = contextWithPartialShootingSet();
  const shootingLog = ctx.logs.get("shoot");
  assert(shootingLog, "shooting log fixture is required");
  shootingLog.completed = false;
  shootingLog.makes = null;
  shootingLog.attempts = null;
  shootingLog.notes = null;

  const outcome = await executeCoachTool(
    successfulSupabaseMock(),
    "user",
    "day",
    ctx,
    "save_shooting_results",
    {
      drill_name: "Shooting",
      set_number: 1,
      makes: 8,
      attempts: 12,
      completed: true,
    },
  );

  assert(
    outcome.result.includes("Next up: set 2 (right side) of Shooting."),
    "the next unfinished set of the same drill must take priority over the next exercise",
  );
});

Deno.test("catalog search prioritizes drills matching the workout's shooting weakness", () => {
  const ctx = contextWithPartialShootingSet();
  const shooting = ctx.exercises.find((exercise) => exercise.id === "shoot")!;
  shooting.name = "Attack Retreat Dribble Threes";
  shooting.instructions = "Attack, retreat, then shoot a three off the dribble";
  const shootingLog = ctx.logs.get("shoot")!;
  shootingLog.completed = true;
  shootingLog.makes = 1;
  shootingLog.attempts = 20;
  shootingLog.notes =
    '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":1,"attempts":10,"minutes":null,"completed":true},{"set_number":2,"makes":0,"attempts":10,"minutes":null,"completed":true}]}';

  const results = rankCatalogExercises(
    "add an attack retreat dribble threes drill for that weakness",
    [
      {
        id: "generic",
        exercise_name: "Form Shooting",
        category: "shooting",
        difficulty_level: "intermediate",
        description: "Close range shooting mechanics",
        coaching_notes: null,
      },
      {
        id: "relevant",
        exercise_name: "Attack Retreat Three Variations",
        category: "shooting",
        difficulty_level: "intermediate",
        description: "Attack and retreat into off-dribble three-point shots",
        coaching_notes: null,
      },
      {
        id: "unrelated",
        exercise_name: "Attack Retreat Finishing",
        category: "finishing",
        difficulty_level: "intermediate",
        description: "Attack, retreat, and finish at the rim",
        coaching_notes: null,
      },
    ],
    ctx,
  );

  assert(
    results[0]?.id === "relevant",
    "the closest drill to the weak shot type should rank first",
  );
  assert(
    results.every((clip) => clip.id !== "unrelated"),
    "matching words must never allow a weakness search to leave the weak category",
  );
});

Deno.test("recommendations use a drill as soon as one set is complete", () => {
  const ctx = contextWithPartialShootingSet();
  const shootingLog = ctx.logs.get("shoot")!;
  shootingLog.makes = 1;
  shootingLog.attempts = 10;
  shootingLog.notes =
    '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":1,"attempts":10,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}';
  const completed = ctx.exercises.find((exercise) => exercise.id === "finish")!;
  completed.category = "defense";
  completed.log_type = "minutes";
  completed.duration = "2 min";
  ctx.logs.set("finish", {
    exercise_id: "finish",
    completed: true,
    makes: null,
    attempts: null,
    minutes_completed: 4,
    difficulty: null,
    notes:
      '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":null,"attempts":null,"minutes":2,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":2,"completed":true}]}',
  } as any);

  const results = rankCatalogExercises(
    "recommend a drill to add",
    [
      {
        id: "shooting",
        exercise_name: "Attack Retreat Threes",
        category: "shooting",
        difficulty_level: "intermediate",
        description: "Off-dribble shooting",
        coaching_notes: null,
      },
      {
        id: "conditioning",
        exercise_name: "Change of Pace Conditioning",
        category: "conditioning",
        difficulty_level: "intermediate",
        description: "A different conditioning focus",
        coaching_notes: null,
      },
    ],
    ctx,
  );

  assert(
    results[0]?.id === "shooting",
    "one completed poor shooting set should drive a same-category recommendation",
  );
  assert(
    results.every((clip) => clip.category === "shooting"),
    "an incomplete drill's completed set must still preserve strict category matching",
  );
});

Deno.test("another recommendation balances weakness severity against existing focused coverage", () => {
  const ctx = contextWithPartialShootingSet();
  const shooting = ctx.exercises.find((exercise) => exercise.id === "shoot")!;
  shooting.name = "Attack Retreat Dribble Threes";
  shooting.instructions = "Attack and retreat into an off-dribble three";
  const shootingLog = ctx.logs.get("shoot")!;
  shootingLog.makes = 1;
  shootingLog.attempts = 10;
  shootingLog.notes =
    '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":1,"attempts":10,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}';

  const finishing = ctx.exercises.find((exercise) => exercise.id === "finish")!;
  finishing.name = "Left Hand Layups";
  ctx.logs.set("finish", {
    exercise_id: "finish",
    completed: false,
    makes: 2,
    attempts: 10,
    minutes_completed: null,
    difficulty: null,
    notes:
      '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":2,"attempts":10,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}',
  } as any);
  ctx.exercises.push({
    ...shooting,
    id: "added-shooting-focus",
    name: "Attack Retreat Three Variations",
    order_index: 6,
  });

  const results = rankCatalogExercises(
    "recommend another drill to add",
    [
      {
        id: "more-shooting",
        exercise_name: "Attack Retreat Three Combo",
        category: "shooting",
        difficulty_level: "intermediate",
        description: "Another attack-retreat shooting variation",
        coaching_notes: null,
      },
      {
        id: "finishing-focus",
        exercise_name: "Weak Hand Finishing",
        category: "finishing",
        difficulty_level: "intermediate",
        description: "Develop left-hand layup control",
        coaching_notes: null,
      },
    ],
    ctx,
  );

  assert(
    results[0]?.id === "finishing-focus",
    "existing focused coverage should allow another measured weakness to take priority",
  );
});

Deno.test("buffer flush preserves partial shooting without completing the set", async () => {
  const rows: Record<string, unknown>[] = [];
  const outcome = await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    contextWithPartialShootingSet(),
    "save_shooting_results",
    {
      drill_name: "Shooting",
      set_number: 2,
      makes: 4,
      attempts: 5,
      completed: false,
    },
  );
  const meta = decodeExerciseLogMeta(String(rows[0].notes ?? ""));
  assert(outcome.dbChanged, "flushing buffered progress should persist");
  assert(
    rows[0].completed === false,
    "partial buffered shots must not complete the drill",
  );
  assert(
    meta.set_logs?.[1].makes === 4,
    "partial makes should remain in set metadata",
  );
  assert(
    meta.set_logs?.[1].attempts === 5,
    "partial attempts should remain in set metadata",
  );
  assert(
    meta.set_logs?.[1].completed === false,
    "the partial set must remain current",
  );
});

Deno.test("buffer flush completes shooting exactly at the attempt target", async () => {
  const rows: Record<string, unknown>[] = [];
  await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    contextWithPartialShootingSet(),
    "save_shooting_results",
    {
      drill_name: "Shooting",
      set_number: 2,
      makes: 7,
      attempts: 12,
      completed: true,
    },
  );
  const meta = decodeExerciseLogMeta(String(rows[0].notes ?? ""));
  assert(
    rows[0].completed === true,
    "the final target attempt should complete the drill",
  );
  assert(
    meta.set_logs?.[1].completed === true,
    "the target-complete set should be saved complete",
  );
});

Deno.test("shot undo can persist a set back to zero attempts", async () => {
  const rows: Record<string, unknown>[] = [];
  await executeCoachTool(
    capturingSupabaseMock(rows),
    "user",
    "day",
    contextWithPartialShootingSet(),
    "save_shooting_results",
    {
      drill_name: "Shooting",
      set_number: 2,
      makes: 0,
      attempts: 0,
      completed: false,
    },
  );
  const meta = decodeExerciseLogMeta(String(rows[0].notes ?? ""));
  assert(
    rows[0].attempts === 12,
    "zero attempts must not fall back to the prescribed attempt target",
  );
  assert(
    meta.set_logs?.[1].attempts === 0 && meta.set_logs?.[1].completed === false,
    "undoing the first shot should persist an empty, incomplete set",
  );
});

Deno.test("realtime shooting tools make single shots deterministic", () => {
  const tools = getRealtimeTools();
  const makeTool = tools.find((tool) => tool.name === "record_make");
  const missTool = tools.find((tool) => tool.name === "record_miss");
  const makesTool = tools.find((tool) => tool.name === "record_makes");
  const missesTool = tools.find((tool) => tool.name === "record_misses");
  const addTool = tools.find((tool) => tool.name === "add_shooting_result");
  const totalTool = tools.find((tool) => tool.name === "set_shooting_total");
  assert(
    Boolean(
      makeTool && missTool && makesTool && missesTool && addTool && totalTool,
    ),
    "all deterministic shot tools must exist",
  );
  assert(
    totalTool?.description.includes("attempts=makes+misses") &&
      totalTool.description.includes("including completed") &&
      totalTool.description.includes("no navigation") &&
      COACH_SYSTEM_PROMPT.includes(
        "correct any completed set directly with set_shooting_total and keep it completed",
      ),
    "completed-set corrections must replace the named set without navigation",
  );
  assert(
    !("attempts" in
      ((makeTool?.parameters?.properties ?? {}) as Record<string, unknown>)) &&
      !("makes" in
        ((missTool?.parameters?.properties ?? {}) as Record<string, unknown>)),
    "single make/miss tools must not accept model-provided shot counts",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes("hard-code one attempt"),
    "Realtime instructions should require deterministic single-shot accounting",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes('"Made another,"') &&
      COACH_SYSTEM_PROMPT.includes("Never invent a denominator"),
    "single-shot phrasing must never be converted into a guessed multi-shot result",
  );
  assert(
    makesTool?.parameters?.required?.includes("count") &&
      missesTool?.parameters?.required?.includes("count") &&
      COACH_SYSTEM_PROMPT.includes("call record_makes once with count N") &&
      COACH_SYSTEM_PROMPT.includes("call record_misses once with count N") &&
      COACH_SYSTEM_PROMPT.includes("NUMBER PRECEDENCE") &&
      makeTool?.description.includes("never use when N>1") &&
      missTool?.description.includes("never use when N>1"),
    "consecutive makes and misses must map to deterministic counted tools",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes(
      'respond with exactly: "You\'re X for Y, N shots left."',
    ) &&
      COACH_SYSTEM_PROMPT.includes("Say nothing before or after it") &&
      COACH_SYSTEM_PROMPT.includes(
        "record_makes adds exactly N makes and N attempts",
      ) &&
      COACH_SYSTEM_PROMPT.includes(
        "record_misses adds zero makes and exactly N attempts",
      ) &&
      COACH_SYSTEM_PROMPT.includes("never call a singular tool"),
    "ordinary shot updates must contain only the exact progress sentence",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes(
      "save only the athlete's actual cumulative makes and actual cumulative attempts",
    ) && COACH_SYSTEM_PROMPT.includes("Never save the prescribed target makes"),
    "saved shooting results must never substitute target or remaining numbers",
  );
  assert(
    COACH_SYSTEM_PROMPT.includes("I actually want to shoot 50 shots") &&
      COACH_SYSTEM_PROMPT.includes("target_attempts=50") &&
      COACH_SYSTEM_PROMPT.includes("Never answer with an updated progress sentence"),
    "explicit shot-count changes must call the target-edit tool instead of narrating progress",
  );
});

Deno.test("realtime sessions transcribe audio and retain stable tool contracts", () => {
  const config = buildRealtimeSessionConfig(
    "instructions",
    "model",
    "voice",
  ) as {
    audio: {
      input: {
        transcription?: { model?: string; language?: string };
        turn_detection?: {
          create_response?: boolean;
          interrupt_response?: boolean;
        };
      };
    };
    reasoning: { effort?: string };
    tools: Array<{ name: string }>;
    truncation: { type?: string; retention_ratio?: number };
  };
  assert(
    config.audio.input.transcription?.model === "gpt-transcribe",
    "input transcription should allow older audio tokens to be discarded",
  );
  assert(
    config.audio.input.transcription?.language === "en",
    "coach transcription is English",
  );
  assert(
    config.audio.input.turn_detection?.create_response === false &&
      config.audio.input.turn_detection?.interrupt_response === false,
    "the client must route transcripts and interruption explicitly",
  );
  assert(
    config.reasoning.effort === "high",
    "realtime reasoning effort should be high",
  );
  assert(
    config.tools.length === getRealtimeTools().length,
    "all realtime tools must remain enabled",
  );
  assert(
    config.truncation.type === "retention_ratio" &&
      config.truncation.retention_ratio === 0.8,
    "prompt-cache-friendly truncation must remain enabled",
  );
  assert(
    COACH_SYSTEM_PROMPT.length < 9_000,
    "shared coach rules exceeded their safe budget",
  );
  assert(
    JSON.stringify(getRealtimeTools()).length < 9_000,
    "realtime tool schemas exceeded their safe budget",
  );
});
