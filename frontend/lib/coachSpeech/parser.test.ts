import {
  isTimerStartConfirmationAffirmative,
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

function expectIntentInActiveShootingSet(phrase: string, expected: ExpectedIntent): void {
  const actual = parseCoachSpeechIntent(phrase, { activeShootingSet: true });
  if (!actual) fail(`Expected "${phrase}" to parse in an active shooting set`);
  assert.equal(actual.kind, expected.kind);
  assert.deepEqual(actual.args, expected.args);
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

test("parses natural requests to flip the latest shot", () => {
  for (const phrase of [
    "undo that",
    "take back the last shot",
    "scratch that",
  ]) {
    expectIntent(phrase, {
      kind: "correct_last_shot",
      args: { action: "flip" },
    });
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
  expectIntent("yo yo yo last shot was a make yo yo yo", {
    kind: "correct_last_shot",
    args: { from: "miss", to: "make" },
  });
  expectIntent("I bricked the latest shot", {
    kind: "correct_last_shot",
    args: { from: "make", to: "miss" },
  });
  expectIntent("please fix the last shot now", {
    kind: "correct_last_shot",
    args: { action: "flip" },
  });
  expectIntent("that was wrong", {
    kind: "correct_last_shot",
    args: { action: "flip" },
  });
  for (const phrase of [
    "Coach, you're wrong",
    "Coach, you got it wrong",
    "Coach, you marked that incorrectly",
    "Coach, you made a mistake",
  ]) {
    expectIntent(phrase, {
      kind: "correct_last_shot",
      args: { action: "flip" },
    });
  }
  expectIntent("Coach, your wrong, I missed that one", {
    kind: "correct_last_shot",
    args: { from: "make", to: "miss" },
  });
  expectIntent("Coach, you're wrong, I made that shot", {
    kind: "correct_last_shot",
    args: { from: "miss", to: "make" },
  });
});

test("parses absolute shooting-total corrections", () => {
  expectIntent("I am 4 for 5", {
    kind: "shot",
    args: { mode: "replace", makes: 4, attempts: 5, source: "ratio" },
  });
  expectIntent("Coach, just so you know, I'm 6 for 7 after that shot", {
    kind: "shot",
    args: { mode: "replace", makes: 6, attempts: 7, source: "ratio" },
  });
  expectIntent("four out of five", {
    kind: "shot",
    args: { mode: "replace", makes: 4, attempts: 5, source: "ratio" },
  });
  expectIntent("I have four makes and one miss", {
    kind: "shot",
    args: { mode: "replace", makes: 4, attempts: 5, source: "count" },
  });
  expectIntent("I only missed one", {
    kind: "correct_shot_misses",
    args: { misses: 1 },
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
  expectIntent("I'm 1 for 1", {
    kind: "shot",
    args: { mode: "replace", makes: 1, attempts: 1, source: "ratio" },
  });
  expectIntent("Coach, I'm one for one", {
    kind: "shot",
    args: { mode: "replace", makes: 1, attempts: 1, source: "ratio" },
  });
  expectIntent("I'm 0 for 0", {
    kind: "shot",
    args: { mode: "replace", makes: 0, attempts: 0, source: "ratio" },
  });
  expectIntent("Coach, I'm zero for zero", {
    kind: "shot",
    args: { mode: "replace", makes: 0, attempts: 0, source: "ratio" },
  });
  expectIntent("Coach, I'm 2 for 1", {
    kind: "shot",
    args: { mode: "replace", makes: 2, attempts: 1, source: "ratio" },
  });
  assert.equal(
    parseCoachSpeechIntent("I just made 0 for 0"),
    null,
    "zero totals are valid only as an absolute replacement",
  );
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

test("accepts hundreds of buffered timer-start confirmations", () => {
  const affirmatives = [
    "yes",
    "yes please",
    "yes do it",
    "yes start it",
    "yeah",
    "yeah please",
    "yeah do it",
    "yep",
    "yup",
    "sure",
    "sure thing",
    "absolutely",
    "definitely",
    "certainly",
    "of course",
    "for sure",
    "sounds good",
    "sounds great",
    "that works",
    "works for me",
    "im ready",
    "i am ready",
    "ready",
    "ready to go",
    "all ready",
    "lets go",
    "let us go",
    "lets do it",
    "let us do it",
    "lets start",
    "let us start",
    "go",
    "go ahead",
    "ahead",
    "do it",
    "please do",
    "start",
    "start it",
    "start now",
    "start the timer",
    "begin",
    "begin now",
    "begin the timer",
    "run it",
    "run the timer",
    "fire it up",
    "fire up the timer",
    "kick it off",
    "get it going",
    "get started",
    "im good",
    "i am good",
    "good to go",
    "all good",
    "okay",
    "ok",
    "okay go",
    "ok go",
    "okay start it",
    "ok start it",
    "why not",
    "fine",
    "perfect",
    "correct",
    "affirmative",
    "you can",
    "you can start",
    "please",
  ] as const;
  const wrappers = [
    ["", ""],
    ["coach ", ""],
    ["well coach ", ""],
    ["", " coach"],
    ["", " right now"],
    ["okay coach ", " right now"],
  ] as const;
  let checked = 0;
  for (const affirmative of affirmatives) {
    for (const [prefix, suffix] of wrappers) {
      assert.ok(
        isTimerStartConfirmationAffirmative(`${prefix}${affirmative}${suffix}`),
        `Expected buffered timer confirmation: ${prefix}${affirmative}${suffix}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 400, `Expected at least 400 confirmation cases, received ${checked}`);
  for (const negative of [
    "no",
    "not ready",
    "yeah no",
    "no yeah",
    "dont start",
    "do not start it",
    "wait im ready",
    "start it later",
    "not yet",
  ]) {
    assert.equal(isTimerStartConfirmationAffirmative(negative), false);
  }
  assert.equal(
    isTimerStartConfirmationAffirmative("one two three yes"),
    false,
    "more than two leading buffer words must not confirm",
  );
  assert.equal(
    isTimerStartConfirmationAffirmative("yes one two three"),
    false,
    "more than two trailing buffer words must not confirm",
  );
});

test("parses hundreds of buffered current-drill explanation requests locally", () => {
  const requests = [
    "explain this drill",
    "explain the current exercise",
    "explain this drill to me",
    "describe this exercise",
    "describe the current drill to me",
    "teach me how to do this drill",
    "explain how to do this",
    "explain how to do this one",
    "walk me through this drill",
    "walk through the current exercise",
    "talk me through this movement",
    "show me how to do this",
    "show me how i perform this drill",
    "tell me how to execute the current exercise",
    "how do i do this",
    "how do i perform this drill",
    "how should i do the current exercise",
    "how should i execute this movement",
    "how am i supposed to do this",
    "how am i supposed to perform this drill",
    "how does this drill work",
    "how does the current exercise work",
    "what am i supposed to do",
    "what am i meant to do",
    "what should i do",
    "what should i do for this drill",
    "what do i need to do",
    "what do i need to do on this exercise",
    "what do i do",
    "what do i do with this drill",
    "what are the instructions",
    "what are the directions for this drill",
    "what are the steps for the current exercise",
    "what is the setup for this movement",
    "give me the instructions",
    "give me directions for this drill",
    "read me the steps for this exercise",
    "remind me what i am supposed to do",
    "tell me how to perform this drill",
    "bro i dont know what to do",
    "i do not understand how to perform this",
    "i dont remember what to do for this drill",
    "what is this drill",
    "how to do this drill",
    "how to perform the current exercise",
  ] as const;
  const wrappers = [
    ["", ""],
    ["coach ", ""],
    ["hey there ", ""],
    ["could you please ", ""],
    ["", " coach"],
    ["", " right now please"],
    ["okay coach please ", " for me now"],
  ] as const;
  let checked = 0;
  for (const request of requests) {
    for (const [prefix, suffix] of wrappers) {
      expectIntent(`${prefix}${request}${suffix}`, {
        kind: "drill_explanation",
        args: { target: "current" },
      });
      checked += 1;
    }
  }
  assert.ok(checked >= 250, `Expected at least 250 explanation cases, received ${checked}`);
  assert.equal(
    parseCoachSpeechIntent("one two three four explain this drill"),
    null,
    "more than three leading buffer words must fall back",
  );
});

test("parses the requested natural current-drill questions locally", () => {
  const requests = [
    "How do I do this one?",
    "What am I supposed to do?",
    "How do I do this drill?",
    "Explain this one.",
    "Can you explain this drill?",
    "What do I do for this one?",
    "How does this one work?",
    "What’s this drill?",
    "Walk me through this one.",
    "What am I doing here?",
    "How am I supposed to do this?",
    "Can you show me how to do this?",
    "What are the steps for this one?",
    "What do I need to do?",
    "Remind me how to do this.",
    "How does this drill go?",
    "What’s the setup for this?",
    "Where do I start?",
    "What do I do first?",
    "Can you break this one down?",
    "Give me the instructions for this one.",
    "What’s the goal of this drill?",
    "How should I do this one?",
    "What am I supposed to be doing right now?",
    "Wait, how do I do this again?",
  ];
  for (const request of requests) {
    expectIntent(request, {
      kind: "drill_explanation",
      args: { target: "current" },
    });
  }
});

test("parses additional natural current-drill questions locally", () => {
  const requests = [
    "What’s the right way to do this?",
    "How do I start this drill?",
    "What exactly am I doing?",
    "What should I be doing on this one?",
    "Can you go over this drill?",
    "Tell me how to do this one.",
    "What’s the move here?",
    "How am I doing this?",
    "What’s the drill supposed to look like?",
    "What do I need to know for this one?",
    "Can you explain what I’m doing here?",
    "What’s the point of this drill?",
    "How do I run this one?",
    "What’s the technique for this?",
    "What am I working on here?",
    "How should this drill go?",
    "Can you walk me through it?",
    "What’s the process for this one?",
    "What do I do on this drill?",
    "How do I perform this one?",
    "What’s the proper way to do it?",
    "What should I focus on for this one?",
    "What does this drill mean?",
    "How do I do the current drill?",
    "Wait, what am I doing again?",
  ];
  for (const request of requests) {
    expectIntent(request, {
      kind: "drill_explanation",
      args: { target: "current" },
    });
  }
});

test("parses concise conversational current-drill questions locally", () => {
  const requests = [
    "What do I do here?",
    "How do I do it?",
    "Can you tell me what to do?",
    "What’s this one about?",
    "What are we doing on this one?",
    "What am I supposed to work on?",
    "How should I run this drill?",
    "Can you remind me what this is?",
    "What do I do next on this drill?",
    "How do I go through this one?",
    "What’s the idea with this drill?",
    "What’s the movement for this?",
    "What should this look like?",
    "How do I set this one up?",
    "Can you explain what I’m supposed to do?",
    "What’s the correct way to do this drill?",
    "What are we working on here?",
    "How do I execute this one?",
    "What’s the drill again?",
    "What am I doing on this one again?",
    "Can you run through this for me?",
    "What’s the instruction for this one?",
    "How am I supposed to start?",
    "Can you break down what I need to do?",
    "What do I need to do on this one?",
  ];
  for (const request of requests) {
    expectIntent(request, {
      kind: "drill_explanation",
      args: { target: "current" },
    });
  }
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
    args: { mode: "action", unit: "drill", target: { type: "named", name: "attack retreat threes", match: "exact" } },
  });
  expectIntent("go to form shooting drill", {
    kind: "navigation",
    args: { mode: "action", unit: "drill", target: { type: "named", name: "form shooting", match: "exact" } },
  });
});

test("parses buffered generic local movement and sends specific drills to Haiku", () => {
  const genericMovements = [
    "move me to the next drill",
    "go to the previous exercise",
    "bring me to whats next",
    "move to the first drill",
    "go to last exercise",
    "move me to the fifth drill",
    "move to shooting",
    "take me to layups",
    "bring me to ball handling",
    "send me to defense",
    "put me on conditioning",
  ] as const;
  const padding = [
    ["", ""],
    ["coach ", ""],
    ["yo coach ", ""],
    ["", " now"],
    ["", " please coach"],
    ["hey coach ", " now"],
  ] as const;
  let checked = 0;
  for (const movement of genericMovements) {
    for (const [prefix, suffix] of padding) {
      const parsed = parseCoachSpeechIntent(`${prefix}${movement}${suffix}`);
      assert.equal(parsed?.kind, "navigation", `Expected local navigation: ${movement}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 65, `Expected at least 65 local movement cases, received ${checked}`);
  for (const request of [
    "i want to do form shooting",
    "i want to practice corner threes",
    "add form shooting drill",
    "include a conditioning exercise",
  ]) {
    assert.equal(parseCoachSpeechIntent(request), null, `Expected Haiku fallback: ${request}`);
  }
  expectIntent("move me to mid range jumpers", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "named", name: "mid range jumpers", match: "exact" },
    },
  });
  expectIntent("take me to wing mid range", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "named", name: "wing mid range", match: "exact" },
    },
  });
  assert.equal(parseCoachSpeechIntent("one two three move to shooting"), null);
  expectIntent("move to shooting three pointers", {
    kind: "navigation",
    args: {
      mode: "action",
      unit: "drill",
      target: { type: "named", name: "shooting three pointers", match: "exact" },
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

test("parses repeat without exposing notes or drill removal", () => {
  expectIntent("say that again", { kind: "repeat", args: {} });
  assert.equal(parseCoachSpeechIntent("save note: my elbow is flaring out"), null);
  assert.equal(parseCoachSpeechIntent("save a note that my legs feel tired"), null);
  assert.equal(parseCoachSpeechIntent("save note keep my guide hand quiet"), null);
  assert.equal(parseCoachSpeechIntent("remove the drill named form shooting"), null);
  assert.equal(parseCoachSpeechIntent("delete exercise attack retreat threes"), null);
});

test("parses explicit set duration and shooting target edits", () => {
  for (const [phrase, durationSeconds] of [
    ["i only want to do 1 minute for this set", 60],
    ["i want to do two minutes", 120],
    ["coach i only want to do 5 minutes though", 300],
    ["i only want 5 minutes though", 300],
    ["i would like to do 45 seconds", 45],
    ["can we just do 30 seconds", 30],
    ["could we do a minute", 60],
    ["lets do 90 secs", 90],
    ["let us do 2 mins", 120],
    ["make this set 1 minute", 60],
    ["set this set for 45 seconds", 45],
    ["change the set timer to be 2 minutes", 120],
    ["change my set duration to 30 seconds", 30],
    ["yo coach can you change the set timer to be 3 minutes instead of 2 minutes", 180],
    ["actually please change this set timer to 45 seconds right now", 45],
    ["hey can we just do 1 minute for this set today please", 60],
    ["think we should make this set 90 seconds instead of 2 minutes", 90],
    ["could you please set my current set time for two minutes now", 120],
    ["run this set for one minute", 60],
  ] as const) {
    expectIntent(phrase, {
      kind: "set_prescription",
      args: { durationSeconds },
    });
  }
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
  assert.equal(
    parseCoachSpeechIntent("set this set target to 8 makes in 12 attempts"),
    null,
  );
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
  assert.equal(parseCoachSpeechIntent("set target makes to eight"), null);
});

test("parses bounded natural shooting attempt-target changes", () => {
  const totalRequests = [
    "i want to shoot 20 shots",
    "i want to shoot 20 total shots",
    "i want to shoot 20 shots total",
    "can i take 20 shots right now",
    "i would like to take twenty shots for this set",
    "i shoot 20 shots",
    "i shoot 20 shots total",
    "i shoot 20 total shots",
    "i shoot 20 shots for this set",
  ] as const;
  const moreRequests = [
    "i want to shoot 8 more",
    "can i shoot 8 more shots",
    "could i shoot 8 more attempts",
    "i want to shoot 8 shots more",
    "can i take eight more shots in this set",
  ] as const;
  const surroundingWords = [
    ["", ""],
    ["yo ", ""],
    ["hey there please ", ""],
    ["yo yo yo ", "coach please now"],
  ] as const;
  for (const [prefix, suffix] of surroundingWords) {
    for (const request of totalRequests) {
      expectIntent(`${prefix}${request} ${suffix}`.trim(), {
        kind: "set_prescription",
        args: { targetAttempts: 20 },
      });
    }
  }
  for (const [prefix, suffix] of surroundingWords) {
    for (const request of moreRequests) {
      expectIntent(`${prefix}${request} ${suffix}`.trim(), {
        kind: "set_prescription",
        args: { targetAttempts: 8, additionalAttempts: true },
      });
    }
  }
  // More than three unrelated words on either side is deliberately rejected.
  assert.equal(
    parseCoachSpeechIntent("friend friend friend friend i shoot 50 shots in this set"),
    null,
  );
  expectIntent("yo yo yo i shoot 50 shots in this set coach please now", {
    kind: "set_prescription",
    args: { targetAttempts: 50 },
  });
  for (const phrase of totalRequests) {
    expectIntent(phrase, { kind: "set_prescription", args: { targetAttempts: 20 } });
  }
  for (const phrase of moreRequests) {
    expectIntent(phrase, { kind: "set_prescription", args: { targetAttempts: 8, additionalAttempts: true } });
  }
});

test("parses local current-set attempt target commands", () => {
  const absoluteCases: [string, Record<string, unknown>][] = [
    ["set attempts to 25", { targetAttempts: 25 }],
    ["change the target shots to twenty five", { targetAttempts: 25 }],
    ["update this set to 30 shots", { targetAttempts: 30 }],
    ["make this set 30 attempts", { targetAttempts: 30 }],
    ["change attempts from 20 to 30", { targetAttempts: 30 }],
    ["set 30 shots instead of 20", { targetAttempts: 30 }],
    ["i want 30 shots instead of 20", { targetAttempts: 30 }],
  ];
  for (const [phrase, args] of absoluteCases) {
    expectIntent(phrase, { kind: "set_prescription", args });
  }

  expectIntent("increase target attempts by 5", {
    kind: "set_prescription",
    args: { attemptAdjustment: 5 },
  });
  expectIntent("reduce the target shots by five", {
    kind: "set_prescription",
    args: { attemptAdjustment: -5 },
  });
  expectIntent("10 more shots", {
    kind: "set_prescription",
    args: { targetAttempts: 10, additionalAttempts: true },
  });

  assert.equal(
    parseCoachSpeechIntent("30 shots"),
    null,
    "number-first forms require active shooting-set context",
  );
  expectIntentInActiveShootingSet("30 shots", {
    kind: "set_prescription",
    args: { targetAttempts: 30 },
  });
  expectIntentInActiveShootingSet("thirty total attempts for this set", {
    kind: "set_prescription",
    args: { targetAttempts: 30 },
  });
  expectIntentInActiveShootingSet("can we do 15 instead", {
    kind: "set_prescription",
    args: { targetAttempts: 15 },
  });
  expectIntentInActiveShootingSet("instead of 20 make it 15", {
    kind: "set_prescription",
    args: { targetAttempts: 15 },
  });
  expectIntentInActiveShootingSet("i only want to shoot five more", {
    kind: "set_prescription",
    args: { targetAttempts: 5, remainingAttempts: true },
  });
  expectIntentInActiveShootingSet("take 5 off", {
    kind: "set_prescription",
    args: { attemptAdjustment: -5 },
  });
});

test("rejects ambiguous, unsafe, impossible, and compound phrases", () => {
  const rejected = [
    "",
    "I made some",
    "three in a row",
    "start a timer for a while",
    "start a two minute timer and skip this drill",
    "reset everything",
    "what should I do next",
    "should I skip this drill",
    "take me somewhere else",
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
    "30 shots",
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
