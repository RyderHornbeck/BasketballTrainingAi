import {
  parseCoachSpeechIntent,
  parseSpokenNumber,
  type CoachSpeechIntent,
} from "./index";
import {
  capShotProgressToTarget,
  mergeShotProgress,
  parseShotSpeechCommand,
  parseSpokenShotCount,
} from "../shotSpeech";
import { bindShotToCursor, cursorMatches } from "../shotCursor";

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
    ["I missed again", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["I made again", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["Dangit, I missed", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["Bruh, I justed missed", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["list", { mode: "increment", makes: 0, attempts: 1, source: "count" }],
    ["may", { mode: "increment", makes: 1, attempts: 1, source: "count" }],
    ["I missed 2 in a row again", { mode: "increment", makes: 0, attempts: 2, source: "count" }],
    ["I just made 2 more again", { mode: "increment", makes: 2, attempts: 2, source: "count" }],
    ["4 buckets", { mode: "increment", makes: 4, attempts: 4, source: "count" }],
    ["bricked two shots", { mode: "increment", makes: 0, attempts: 2, source: "count" }],
    ["three airballs", { mode: "increment", makes: 0, attempts: 3, source: "count" }],
    ["I made 2 and missed 3", { mode: "increment", makes: 2, attempts: 5, source: "count" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "shot", args });
});

test("caps final-shot progress and supports absolute target totals", () => {
  assert.deepEqual(
    capShotProgressToTarget({ makes: 10, attempts: 11 }, 10),
    { makes: 10, attempts: 10 },
    "a duplicate final make cannot create an eleventh attempt on a ten-shot set",
  );
  assert.deepEqual(
    capShotProgressToTarget({ makes: 8, attempts: 13 }, 12),
    { makes: 8, attempts: 12 },
    "a multi-shot update crossing the target stops at the final allowed attempt",
  );
  assert.deepEqual(
    capShotProgressToTarget({ makes: 9, attempts: 20 }, 20),
    { makes: 9, attempts: 20 },
    "an absolute total at the target remains an exact final-set result",
  );
});

test("binds ordinary shots to the live cursor after a set transition", () => {
  const bound = bindShotToCursor(
    { exercise_id: "old-drill", drill_name: "Old drill", set_number: 1, makes: 0, attempts: 1 },
    { exerciseId: "live-drill", drillName: "Live drill", setNumber: 2 },
  );
  assert.deepEqual(
    bound,
    { exercise_id: "live-drill", drill_name: "Live drill", set_number: 2, makes: 0, attempts: 1 },
    "a late model call cannot carry an old drill or set into a plain miss",
  );
  assert.ok(
    !cursorMatches(
      { exerciseId: "live-drill", drillName: null, setNumber: 2 },
      "old-drill",
      1,
    ),
    "a stale snapshot cursor must not replace the protected transition cursor",
  );
});

test("parses natural requests to undo the latest shot", () => {
  for (const phrase of [
    "undo that",
    "take back the last shot",
    "remove my previous miss",
    "scratch that",
  ]) {
    expectIntent(phrase, { kind: "undo_shot", args: {} });
  }
});

test("parses session shot corrections without completing a set", () => {
  expectIntent("I'm actually 2 for 2", {
    kind: "shot",
    args: { mode: "replace", makes: 2, attempts: 2, source: "ratio" },
  });
  expectIntent("I'm actually 2 for 2, 18 shots left", {
    kind: "shot",
    args: { mode: "replace", makes: 2, attempts: 2, source: "ratio" },
  });
  expectIntent("you counted a make instead of a miss", {
    kind: "correct_last_shot",
    args: { from: "make", to: "miss" },
  });
  expectIntent("you marked a miss as a make", {
    kind: "correct_last_shot",
    args: { from: "miss", to: "make" },
  });
});

test("removes conversational padding before every command family", () => {
  expectIntent("Bruh, can you start a thirty second timer?", {
    kind: "timer",
    args: { action: "start", durationSeconds: 30 },
  });
  expectIntent("Dang, what's next?", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("Man, finish this set", {
    kind: "completion",
    args: { action: "complete", scope: "set" },
  });
  expectIntent("Ugh, how many shots left?", {
    kind: "progress",
    args: { metric: "remaining", scope: "set" },
  });
  expectIntent("Well, list workout drills", {
    kind: "list_drills",
    args: {},
  });
  expectIntent("Okay, say that again", {
    kind: "repeat",
    args: {},
  });
  expectIntent("Um coach, so I just airballed", {
    kind: "shot",
    args: { mode: "increment", makes: 0, attempts: 1, source: "count" },
  });
  expectIntent("Um coach, so I just made it", {
    kind: "shot",
    args: { mode: "increment", makes: 1, attempts: 1, source: "count" },
  });
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
  expectIntent("I'm 0 for 0", {
    kind: "shot",
    args: { mode: "replace", makes: 0, attempts: 0, source: "ratio" },
  });
  expectIntent("120 for 200", {
    kind: "shot",
    args: { mode: "replace", makes: 120, attempts: 200, source: "ratio" },
  });
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
    ["hey coach can you start a timer", { action: "start", useSetDefault: true }],
    ["start the timer for this set", { action: "start", useSetDefault: true }],
    ["start the timer for that set", { action: "start", useSetDefault: true }],
    ["start a stopwatch", { action: "start", useSetDefault: true }],
    ["start a 2 minute timer", { action: "start", durationSeconds: 120 }],
    ["start a 1 minute timer for this set", {
      action: "start",
      durationSeconds: 60,
    }],
    ["start a 30 second timer for that set", {
      action: "start",
      durationSeconds: 30,
    }],
    ["Start a 5-minute timer.", { action: "start", durationSeconds: 300 }],
    ["Start a five-minute time.", { action: "start", durationSeconds: 300 }],
    ["Start five minutes.", { action: "start", durationSeconds: 300 }],
    ["Yo coach, can you start a 5 minute timer?", { action: "start", durationSeconds: 300 }],
    ["hey coach can you start atimer", { action: "start", useSetDefault: true }],
    ["Could you fire up a ninety second timer, coach?", {
      action: "start",
      durationSeconds: 90,
    }],
    ["Can we start me a one minute timer?", { action: "start", durationSeconds: 60 }],
    ["timer for 90 seconds", { action: "start", durationSeconds: 90 }],
    ["set timer for one minute", { action: "start", durationSeconds: 60 }],
    ["give me a 45 second countdown", { action: "start", durationSeconds: 45 }],
    ["three minute timer", { action: "start", durationSeconds: 180 }],
    ["run a timer for 2 minutes", { action: "start", durationSeconds: 120 }],
    ["pause timer", { action: "pause" }],
    ["hold the timer", { action: "pause" }],
    ["freeze the countdown", { action: "pause" }],
    ["stop the timer", { action: "pause" }],
    ["take a break timer", { action: "pause" }],
    ["resume timer", { action: "resume" }],
    ["continue the timer", { action: "resume" }],
    ["unpause the stopwatch", { action: "resume" }],
    ["start it back up again", { action: "resume" }],
    ["stop timer", { action: "pause" }],
    ["end the timer", { action: "pause" }],
    ["cancel timer", { action: "pause" }],
    ["clear the countdown", { action: "pause" }],
    ["reset timer", { action: "reset" }],
    ["restart the timer", { action: "restart" }],
    ["start the timer over", { action: "restart" }],
    ["how much time is left", { action: "status" }],
    ["how long is remaining on the countdown", { action: "status" }],
    ["time remaining", { action: "status" }],
    ["what's time left on the timer", { action: "status" }],
    ["what's the time", { action: "status" }],
    ["what time is it", { action: "status" }],
    ["what's the timer at", { action: "status" }],
    ["how much time do I have", { action: "status" }],
    ["what's on the clock", { action: "status" }],
    ["timer status", { action: "status" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "timer", args });
});

test("stops Coach speech without treating it as a timer command", () => {
  for (const phrase of ["stop talking", "stop speaking", "be quiet", "shh"]) {
    expectIntent(phrase, {
      kind: "speech_control",
      args: { action: "stop_speaking" },
    });
  }
});

test("keeps navigation queries separate from movement", () => {
  expectIntent("what's next", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("Coach's, what's next?", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("Hey coach, what do I have up next for me?", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("what's the next set", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("which set am i 0 for 1", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "current" } },
  });
  expectIntent("what drill am I on", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "current" } },
  });
  expectIntent("where are we", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "current" } },
  });
  expectIntent("Yo coach, can you tell me what exercise am I on?", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "current" } },
  });
  expectIntent("Which exercise am I doing, coach?", {
    kind: "navigation",
    args: { mode: "query", unit: "drill", target: { type: "current" } },
  });
  expectIntent("what comes after this", {
    kind: "navigation",
    args: { mode: "query", unit: "set", target: { type: "next" } },
  });
  expectIntent("next drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "next" }, skip: false },
  });
  for (
    const phrase of [
      "let's move on",
      "lets move on",
      "move on",
      "let's go",
      "okay lets continue",
      "lets now continue",
      "let's now continue",
    ]
  ) {
    expectIntent(phrase, {
      kind: "navigation",
      args: {
        mode: "query",
        unit: "set",
        target: { type: "next" },
      },
    });
  }
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
    ["mark that set complete", { action: "complete", scope: "set" }],
    ["mark the set complete", { action: "complete", scope: "set" }],
    ["complete that set", { action: "complete", scope: "set" }],
    ["finish the current drill", { action: "complete", scope: "exercise" }],
    ["complete this workout", { action: "complete", scope: "workout" }],
    ["reopen this set", { action: "reopen", scope: "set" }],
    ["mark current drill incomplete", { action: "reopen", scope: "exercise" }],
    ["uncomplete the current workout", { action: "reopen", scope: "workout" }],
    ["complete set two", { action: "complete", scope: "set", setNumber: 2 }],
    ["mark set 3 incomplete", { action: "reopen", scope: "set", setNumber: 3 }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "completion", args });
});

test("parses scoped percentage and progress queries", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["what's my shooting percentage for this set", { metric: "percentage", scope: "set" }],
    ["what's my shooting percentage", { metric: "percentage", scope: "exercise" }],
    ["shooting percentage", { metric: "percentage", scope: "exercise" }],
    ["what am I shooting right now", { metric: "percentage", scope: "exercise" }],
    ["how am I shooting so far", { metric: "percentage", scope: "exercise" }],
    ["percentage for this exercise", { metric: "percentage", scope: "exercise" }],
    ["shooting percent for my workout", { metric: "percentage", scope: "workout" }],
    ["What's my shooting percentage for this work out?", {
      metric: "percentage",
      scope: "workout",
    }],
    ["What's my shooting percentage for the whole workout so far?", {
      metric: "percentage",
      scope: "workout",
    }],
    ["what's my total shooting percentage", { metric: "percentage", scope: "workout" }],
    ["show me my overall shooting percent for this workout", {
      metric: "percentage",
      scope: "workout",
    }],
    ["what's my progress for this set", { metric: "progress", scope: "set" }],
    ["what's my progress", { metric: "progress", scope: "exercise" }],
    ["how far am I through this workout", { metric: "progress", scope: "workout" }],
    ["show me my progress on this drill", { metric: "progress", scope: "exercise" }],
    ["how is my progress in the workout", { metric: "progress", scope: "workout" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "progress", args });
});

test("parses targets, totals, and remaining-work queries", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["how many shots left", { metric: "remaining", scope: "set" }],
    ["shots remaining", { metric: "remaining", scope: "set" }],
    ["how many more shots to go", { metric: "remaining", scope: "set" }],
    ["how many sets do I have left", { metric: "remaining", scope: "exercise" }],
    ["sets to go", { metric: "remaining", scope: "exercise" }],
    ["how many exercises are left", { metric: "remaining", scope: "workout" }],
    ["what's left in this workout", { metric: "remaining", scope: "workout" }],
    ["what's my target for this set", { metric: "target", scope: "set" }],
    ["what's my target and attempts for this set", { metric: "target", scope: "set" }],
    ["what are my target makes and attempts", { metric: "target", scope: "set" }],
    ["what are this set's attempts", { metric: "target", scope: "set" }],
    ["how many attempts are in this set", { metric: "target", scope: "set" }],
    ["what's the goal", { metric: "target", scope: "set" }],
    ["what am I aiming for", { metric: "target", scope: "set" }],
    ["how many makes do I have in this set", { metric: "totals", scope: "set", totalsField: "makes" }],
    ["makes so far", { metric: "totals", scope: "exercise", totalsField: "makes" }],
    ["how many misses in this workout", { metric: "totals", scope: "workout", totalsField: "misses" }],
  ];
  for (const [phrase, args] of cases) expectIntent(phrase, { kind: "progress", args });
});

test("parses repeat, prefixed notes, and exact drill removal", () => {
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
});

test("parses explicit set duration and shooting target edits", () => {
  expectIntent("change this set to 30 seconds", {
    kind: "set_prescription",
    args: { durationSeconds: 30 },
  });
  expectIntent("change that set to 30 seconds", {
    kind: "set_prescription",
    args: { durationSeconds: 30 },
  });
  expectIntent("change the duration for that set to 45 seconds", {
    kind: "set_prescription",
    args: { durationSeconds: 45 },
  });
  expectIntent("set set two duration to 45 seconds", {
    kind: "set_prescription",
    args: { setNumber: 2, durationSeconds: 45 },
  });
  expectIntent("set this set target to 8 makes in 12 attempts", {
    kind: "set_prescription",
    args: { targetMakes: 8, targetAttempts: 12 },
  });
  expectIntent("change my attempts to 20", {
    kind: "set_prescription",
    args: { targetAttempts: 20 },
  });
  expectIntent("I actually want to shoot 50 shots", {
    kind: "set_prescription",
    args: { targetAttempts: 50 },
  });
  expectIntent("can we shoot 30 shots", {
    kind: "set_prescription",
    args: { targetAttempts: 30 },
  });
  expectIntent("I want to shoot 8 more", {
    kind: "set_prescription",
    args: { targetAttempts: 8, additionalAttempts: true },
  });
  expectIntent("set target makes to eight", {
    kind: "set_prescription",
    args: { targetMakes: 8 },
  });
});

test("rejects ambiguous, unsafe, impossible, and compound phrases", () => {
  const rejected = [
    "",
    "I made some",
    "three in a row",
    "10 for 6",
    "start a timer for a while",
    "start a two minute timer and skip this drill",
    "reset everything",
    "what should I do next",
    "should I skip this drill",
    "take me somewhere else",
    "go to shooting",
    "I'm done",
    "finish this",
    "save this thought",
    "note my elbow hurts",
    "remove this drill",
    "remove the next drill",
    "make the workout longer",
    "shorten the workout a little",
    "make it ten",
    "change it",
    "set my target to 12 makes in 8 attempts",
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
  const first = mergeShotProgress(
    { makes: 0, attempts: 0 },
    { makes: 2, attempts: 2, mode: "increment" }
  );
  assert.deepEqual(first, { makes: 2, attempts: 2 });
  assert.deepEqual(
    mergeShotProgress(first, { makes: 2, attempts: 2, mode: "increment" }),
    { makes: 4, attempts: 4 }
  );
  assert.deepEqual(
    mergeShotProgress(first, { makes: 0, attempts: 2, mode: "increment" }),
    { makes: 2, attempts: 4 }
  );
});
