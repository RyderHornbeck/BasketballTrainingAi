import {
  isLikelyPlaybackEcho,
  isSafeSpeculativeTranscript,
  normalizeSpeculativeTranscript,
  shouldPromoteSpeculation,
} from "./speculation";

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

const speculation = {
  inkRequestId: "ink-1",
  transcript: "What is next?",
  speechEpoch: 4,
  stateVersion: 9,
  aborted: false,
};

test("normalizes harmless transcript spacing and casing", () => {
  equal(normalizeSpeculativeTranscript("  WHAT   is Next? "), "what is next?");
});

test("never speculates direct mutation commands", () => {
  equal(isSafeSpeculativeTranscript("motivate me"), true);
  equal(isSafeSpeculativeTranscript("what is next?"), false);
  equal(isSafeSpeculativeTranscript("how should I shoot this?"), false);
  equal(isSafeSpeculativeTranscript("add a shooting drill"), false);
  equal(isSafeSpeculativeTranscript("please change set two"), false);
  equal(isSafeSpeculativeTranscript("start a timer"), false);
  equal(isSafeSpeculativeTranscript("hey coach can you start a timer"), false);
  equal(isSafeSpeculativeTranscript("I want to do V dribbles"), false);
});

test("promotes only an identical current final turn", () => {
  equal(
    shouldPromoteSpeculation(speculation, {
      inkRequestId: "ink-1",
      transcript: " what IS next? ",
      speechEpoch: 4,
      stateVersion: 9,
    }),
    true
  );
});

test("suppresses substantial assistant echo but permits a user interruption", () => {
  equal(
    isLikelyPlaybackEcho(
      "Moved to form shooting, set one of three",
      "Moved to Form Shooting, set 1 of 3. The previous drill was left unchanged.",
    ),
    true,
  );
  equal(
    isLikelyPlaybackEcho(
      "stop the timer now",
      "Moved to Form Shooting, set 1 of 3.",
    ),
    false,
  );
});

test("rejects resumed, stale, changed, and aborted speculation", () => {
  equal(
    shouldPromoteSpeculation({ ...speculation, aborted: true }, {
      inkRequestId: "ink-1",
      transcript: "What is next?",
      speechEpoch: 4,
      stateVersion: 9,
    }),
    false
  );
  for (const finalTurn of [
    { inkRequestId: "ink-2", transcript: "What is next?", speechEpoch: 4, stateVersion: 9 },
    { inkRequestId: "ink-1", transcript: "What is next after that?", speechEpoch: 4, stateVersion: 9 },
    { inkRequestId: "ink-1", transcript: "What is next?", speechEpoch: 5, stateVersion: 9 },
    { inkRequestId: "ink-1", transcript: "What is next?", speechEpoch: 4, stateVersion: 10 },
  ]) {
    equal(shouldPromoteSpeculation(speculation, finalTurn), false);
  }
});
