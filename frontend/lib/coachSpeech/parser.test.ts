import {
  parseCoachSpeechIntent,
  parseSpokenNumber,
  type CoachSpeechIntent,
} from "./index";
import { parseShotSpeechCommand, parseSpokenShotCount } from "../shotSpeech";

function fail(message: string): never {
  throw new Error(message);
}

const assert = {
  equal(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) fail(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  },
  ok(value: unknown, message?: string): void {
    if (!value) fail(message ?? "Expected value to be truthy");
  },
  match(value: string, pattern: RegExp, message?: string): void {
    if (!pattern.test(value)) fail(message ?? `Expected "${value}" to match ${String(pattern)}`);
  },
};

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

type ExpectedIntent = {
  kind: CoachSpeechIntent["kind"];
  args: Record<string, unknown>;
};

function expectIntent(phrase: string, expected: ExpectedIntent): void {
  const actual = parseCoachSpeechIntent(phrase);
  if (!actual) fail(`Expected "${phrase}" to parse`);
  assert.equal(actual.kind, expected.kind);
  assert.deepEqual(actual.args, expected.args);
  assert.equal(actual.safeToDelete, true);
  assert.ok(actual.confidence >= 0.95 && actual.confidence <= 1);
  assert.match(actual.heardLabel, /heard$/);
}

test("parses spoken cardinal numbers", () => {
  assert.equal(parseSpokenNumber("zero"), 0);
  assert.equal(parseSpokenNumber("twenty-one"), 21);
  assert.equal(parseSpokenNumber("ninety nine"), 99);
  assert.equal(parseSpokenNumber("one hundred"), 100);
  assert.equal(parseSpokenNumber("one hundred twenty"), 120);
  assert.equal(parseSpokenNumber("1000"), null);
  assert.equal(parseSpokenNumber("a couple"), null);
});

test("parses make and miss vocabulary", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["make", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["I made one.", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["hit it", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["swish", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["swished", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["bucket", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["miss", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["bricked", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["air ball", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["airballed", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["made three in a row", { mode: "increment", makes: 3, attempts: 3, source: "count" }],
    ["4 buckets", { mode: "increment", makes: 4, attempts: 4, source: "count" }],
    ["bricked two shots", { mode: "increment", makes: 0, attempts: 2, source: "count" }],
    ["three airballs", { mode: "increment", makes: 0, attempts: 3, source: "count" }],
    ["I made 2 and missed 3", { mode: "increment", makes: 2, attempts: 5, source: "count" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "shot", args });
});

test("distinguishes incremental and absolute shot ratios", () => {
  const absolute = {
    mode: "replace",
    makes: 6,
    attempts: 10,
    source: "ratio",
  };
  expectIntent("I'm 6 for 10", { kind: "shot", args: absolute });
  expectIntent("six out of ten", { kind: "shot", args: absolute });
  expectIntent("6/10", { kind: "shot", args: absolute });
  expectIntent("I just made 2 for 3", {
    kind: "shot",
    args: { mode: "increment", makes: 2, attempts: 3, source: "ratio" },
  });
  expectIntent("made four of five", {
    kind: "shot",
    args: { mode: "increment", makes: 4, attempts: 5, source: "ratio" },
  });
});

test("parses timer starts, controls, and status", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["start a timer", { action: "start", useSetDefault: true }],
    ["start the timer for this set", { action: "start", useSetDefault: true }],
    ["start a stopwatch", { action: "start", useSetDefault: true }],
    ["start a 2 minute timer", { action: "start", durationSeconds: 120 }],
    ["timer for 90 seconds", { action: "start", durationSeconds: 90 }],
    ["set timer for one minute", { action: "start", durationSeconds: 60 }],
    ["pause timer", { action: "pause" }],
    ["hold the timer", { action: "pause" }],
    ["resume timer", { action: "resume" }],
    ["continue the timer", { action: "resume" }],
    ["stop timer", { action: "stop" }],
    ["end the timer", { action: "stop" }],
    ["cancel timer", { action: "stop" }],
    ["reset timer", { action: "reset" }],
    ["restart the timer", { action: "restart" }],
    ["how much time is left", { action: "status" }],
    ["what's time left on the timer", { action: "status" }],
    ["timer status", { action: "status" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "timer", args });
});

test("keeps navigation queries separate from movement", () => {
  expectIntent("what's next", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("what's the next set", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("what drill am I on", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "current" } },
  });
  expectIntent("what comes after this", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "next" } },
  });
  expectIntent("next drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "next" }, skip: false },
  });
  expectIntent("skip this drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "next" }, skip: true },
  });
  expectIntent("can we skip this drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "next" }, skip: true },
  });
  expectIntent("go to the previous set", {
    kind: "navigation",
    args: { mode: "action", unit: "set", target: { type: "previous" }, skip: false },
  });
  expectIntent("move me to the first exercise", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "first" }, skip: false },
  });
  expectIntent("go to last drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "last" }, skip: false },
  });
  expectIntent("go to set two", {
    kind: "navigation",
    args: { mode: "action", unit: "set", target: { type: "ordinal", ordinal: 2 } },
  });
  expectIntent("move to the 3rd drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "ordinal", ordinal: 3 } },
  });
  expectIntent("move me to five from the end", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "from_end", offset: 5 },
    },
  });
  expectIntent("go to drill named attack retreat threes", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "named", name: "attack retreat threes", match: "exact" },
    },
  });
  expectIntent("go to form shooting drill", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "named", name: "form shooting", match: "exact" },
    },
  });
});

test("parses ordered drill listing queries", () => {
  expectIntent("list workout drills", { kind: "list_drills", args: {} });
  expectIntent("what drills are in this workout", { kind: "list_drills", args: {} });
});

test("parses completion and reopen commands at explicit scopes", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["I'm finished with this set", { action: "complete", scope: "set" }],
    ["mark this set complete", { action: "complete", scope: "set" }],
    ["finish the current drill", { action: "complete", scope: "exercise" }],
    ["complete this workout", { action: "complete", scope: "workout" }],
    ["reopen this set", { action: "reopen", scope: "set" }],
    ["mark current drill incomplete", { action: "reopen", scope: "exercise" }],
    ["uncomplete the current workout", { action: "reopen", scope: "workout" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "completion", args });
});

test("parses scoped percentage and progress queries", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["what's my shooting percentage for this set", { metric: "percentage", scope: "set" }],
    ["percentage for this exercise", { metric: "percentage", scope: "exercise" }],
    ["shooting percent for my workout", { metric: "percentage", scope: "workout" }],
    ["what's my progress for this set", { metric: "progress", scope: "set" }],
    ["show me my progress on this drill", { metric: "progress", scope: "exercise" }],
    ["how is my progress in the workout", { metric: "progress", scope: "workout" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "progress", args });
});

test("parses targets, totals, and remaining-work queries", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["how many shots left", { metric: "remaining", scope: "set" }],
    ["how many sets do I have left", { metric: "remaining", scope: "exercise" }],
    ["how many exercises are left", { metric: "remaining", scope: "workout" }],
    ["what's my target for this set", { metric: "target", scope: "set" }],
    ["how many makes do I have in this set", { metric: "totals", scope: "set" }],
    ["how many misses in this workout", { metric: "totals", scope: "workout" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "progress", args });
});

test("parses repeat, prefixed notes, exact removal, and explicit workout changes", () => {
  expectIntent("say that again", { kind: "repeat", args: {} });
  expectIntent("save note: my elbow is flaring out", {
    kind: "save_note",
    args: { note: "my elbow is flaring out" },
  });
  expectIntent("save a note that my legs feel tired", {
    kind: "save_note",
    args: { note: "my legs feel tired" },
  });
  expectIntent("save note keep my guide hand quiet", {
    kind: "save_note",
    args: { note: "keep my guide hand quiet" },
  });
  expectIntent("remove the drill named form shooting", {
    kind: "remove_drill",
    args: { name: "form shooting", match: "exact" },
  });
  expectIntent("delete exercise attack retreat threes", {
    kind: "remove_drill",
    args: { name: "attack retreat threes", match: "exact" },
  });
  expectIntent("extend the workout by five minutes", {
    kind: "adjust_workout",
    args: { action: "extend", durationSeconds: 300 },
  });
  expectIntent("shorten my workout by 90 seconds", {
    kind: "adjust_workout",
    args: { action: "shorten", durationSeconds: 90 },
  });
});

test("rejects ambiguous, unsafe, impossible, and compound phrases", () => {
  const rejected = [
    "",
    "I made some",
    "three in a row",
    "10 for 6",
    "0 for 0",
    "start a timer for a while",
    "start a two minute timer and skip this drill",
    "pause",
    "reset everything",
    "what should I do next",
    "should I skip this drill",
    "take me somewhere else",
    "go to shooting",
    "I'm done",
    "finish this",
    "what's my percentage",
    "save this thought",
    "note my elbow hurts",
    "remove this drill",
    "remove the next drill",
    "make the workout longer",
    "shorten the workout a little",
    "was that a brick",
    "I made one but it felt bad",
  ];
  for (const phrase of rejected) {
    assert.equal(parseCoachSpeechIntent(phrase), null, `Expected "${phrase}" to fall back`);
  }
});

test("preserves the shotSpeech compatibility exports", () => {
  assert.deepEqual(parseShotSpeechCommand("I made two"), {
    mode: "increment",
    makes: 2,
    attempts: 2,
    source: "count",
  });
  assert.deepEqual(parseShotSpeechCommand("4 out of 5"), {
    mode: "replace",
    makes: 4,
    attempts: 5,
    source: "ratio",
  });
  assert.deepEqual(parseSpokenShotCount("brick"), { made: false, count: 1 });
  assert.deepEqual(parseSpokenShotCount("three swishes"), { made: true, count: 3 });
  assert.equal(parseSpokenShotCount("made 2 and missed 1"), null);
  assert.equal(parseShotSpeechCommand("pause timer"), null);
});
