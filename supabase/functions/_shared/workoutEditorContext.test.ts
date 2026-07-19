import { buildWorkoutEditorSnapshot } from "./workoutEditorContext.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("editor context includes aggregate and per-set logged workout progress", () => {
  const snapshot = buildWorkoutEditorSnapshot(
    { active_exercise_id: "drill-1" },
    [
      {
        id: "drill-1",
        sets: "2",
        log_type: "makes_attempts",
        target_makes: 8,
        target_attempts: 12,
        duration: "3 min",
      },
    ],
    [
      {
        id: "log-1",
        exercise_id: "drill-1",
        completed: false,
        makes: 5,
        attempts: 12,
        minutes_completed: null,
        notes:
          '__hoop_set_logs__:{"set_logs":[{"set_number":1,"makes":5,"attempts":12,"minutes":null,"completed":true},{"set_number":2,"makes":null,"attempts":null,"minutes":null,"completed":false}]}',
      },
    ]
  );

  const drill = snapshot.exercises[0];
  assert(snapshot.active_exercise_id === "drill-1", "active drill must be present");
  assert(drill.log.makes === 5 && drill.log.attempts === 12, "aggregate log must be present");
  assert(drill.set_progress.length === 2, "all prescribed sets must be present");
  assert(drill.set_progress[0].completed, "completed set state must be retained");
  assert(drill.set_progress[0].makes === 5, "set makes must be retained");
  assert(!drill.set_progress[1].completed, "incomplete set state must be retained");
});
