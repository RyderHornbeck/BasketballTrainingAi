import { parseSafePlaybackShotIntent } from "./playbackShotIntent";

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

const transitionSpeech =
  "You shot 15 for 20. You're now on set 2 of form shooting. Start shooting.";

test("accepts a direct one-word shot during playback", () => {
  equal(
    parseSafePlaybackShotIntent("miss", transitionSpeech)?.kind,
    "shot",
  );
});

test("accepts counted makes and misses during playback", () => {
  const cases: [string, number, number][] = [
    ["I made 2 in a row", 2, 2],
    ["I missed 4 in a row", 0, 4],
    ["made two more", 2, 2],
    ["bricked three shots", 0, 3],
    ["I made 2 and missed 3", 2, 5],
  ];
  for (const [transcript, makes, attempts] of cases) {
    const parsed = parseSafePlaybackShotIntent(transcript, transitionSpeech);
    equal(parsed?.kind, "shot");
    equal(parsed?.args.makes, makes);
    equal(parsed?.args.attempts, attempts);
  }
});

test("recovers a shot merged with transition echo", () => {
  const parsed = parseSafePlaybackShotIntent(
    "you're now on set 2 of form shooting start shooting miss",
    transitionSpeech,
  );
  equal(parsed?.kind, "shot");
  equal(parsed?.args.makes, 0);
  equal(parsed?.args.attempts, 1);
});

test("recovers counted shots merged with transition echo", () => {
  const parsed = parseSafePlaybackShotIntent(
    "you're now on set 2 of form shooting start shooting i missed 4 in a row",
    transitionSpeech,
  );
  equal(parsed?.kind, "shot");
  equal(parsed?.args.makes, 0);
  equal(parsed?.args.attempts, 4);
});

test("rejects Coach's reflected shot wording", () => {
  equal(
    parseSafePlaybackShotIntent(
      "you made two",
      "Nice work, you made two in a row.",
    ),
    null,
  );
});

test("does not reinterpret an unrelated sentence ending in make", () => {
  equal(
    parseSafePlaybackShotIntent(
      "what adjustment should I make",
      transitionSpeech,
    ),
    null,
  );
});
