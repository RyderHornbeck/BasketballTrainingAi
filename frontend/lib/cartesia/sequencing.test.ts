import { shouldAcceptPlaybackChunk, shouldAcceptTurnEvent } from "./sequencing";

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

equal(
  shouldAcceptTurnEvent(
    { turnId: "turn-1", speechEpoch: 2, stateVersion: 5 },
    { turnId: "turn-1", speechEpoch: 2, stateVersion: 5 }
  ),
  true
);

const current = {
  speechEpoch: 3,
  playbackGeneration: 7,
  contextId: "context-1",
  active: true,
};
equal(
  shouldAcceptPlaybackChunk(current, {
    speechEpoch: 3,
    playbackGeneration: 7,
    contextId: "context-1",
  }),
  true
);
equal(
  shouldAcceptPlaybackChunk(current, {
    speechEpoch: 3,
    playbackGeneration: 6,
    contextId: "context-1",
  }),
  false
);
equal(
  shouldAcceptPlaybackChunk(current, {
    speechEpoch: 2,
    playbackGeneration: 7,
    contextId: "context-1",
  }),
  false
);
equal(
  shouldAcceptPlaybackChunk(current, {
    speechEpoch: 3,
    playbackGeneration: 7,
    contextId: "stale-context",
  }),
  false
);

console.log("✓ playback sequencing rejects stale queued audio");
