import {
  aggregateSetLogs,
  resolveAttemptsOverride,
  type ExerciseSetPlan,
  type SetLogEntry,
} from "./exerciseSetLogs.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shootingPlan: ExerciseSetPlan = {
  setCount: 2,
  logType: "makes_attempts",
  perSetMakes: 8,
  perSetAttempts: 12,
  perSetMinutes: null,
};

Deno.test("unfinished target rows do not inflate logged attempts", () => {
  const rows: SetLogEntry[] = [
    { set_number: 1, completed: true, makes: 8, attempts: 12, minutes: null },
    { set_number: 2, completed: false, makes: null, attempts: 12, minutes: null },
  ];

  const totals = aggregateSetLogs(rows, shootingPlan);
  assert(totals.makes === 8, "only completed-set makes should count");
  assert(totals.attempts === 12, "future target attempts should not count");
  assert(totals.completed === false, "the drill remains incomplete");
});

Deno.test("different per-set attempts are not a drill-wide override", () => {
  const rows: SetLogEntry[] = [
    { set_number: 1, completed: true, makes: 7, attempts: 10, minutes: null },
    { set_number: 2, completed: true, makes: 9, attempts: 15, minutes: null },
  ];

  assert(
    resolveAttemptsOverride({}, rows) === null,
    "different set prescriptions must remain per-set values"
  );
});

Deno.test("matching progress attempts never shrink the prescribed target", () => {
  const rows: SetLogEntry[] = [
    { set_number: 1, completed: false, makes: null, attempts: 3, minutes: null },
    { set_number: 2, completed: false, makes: null, attempts: 3, minutes: null },
  ];

  assert(
    resolveAttemptsOverride({}, rows) === null,
    "matching progress rows must not turn a 20-shot target into 3 shots"
  );
  assert(
    resolveAttemptsOverride({ per_set_attempts_override: 3 }, rows) === null,
    "legacy metadata must not replace the workout exercise target"
  );
});
