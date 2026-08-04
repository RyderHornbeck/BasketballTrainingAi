import { consumeNdjsonStream } from "./coachTurnNdjson";
import type { CoachTurnStreamEvent } from "./coachTurnStream";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function testChunkBoundariesAndFinalLine(): Promise<void> {
  const events: CoachTurnStreamEvent[] = [];
  await consumeNdjsonStream<CoachTurnStreamEvent>(
    chunkedStream([
      '{"type":"turn_started","turn_id":"turn-1","model":"luna",',
      '"state_version":1,"state_fingerprint":"a"}\n',
      '{"type":"text_delta","turn_id":"turn-1","state_version":1,"delta":"Ready."}',
    ]),
    (event) => {
      events.push(event);
    },
  );
  assert(events.length === 2, "both split and unterminated NDJSON events must be emitted");
  assert(events[0]?.type === "turn_started", "the first event should retain ordering");
  assert(
    events[1]?.type === "text_delta" && events[1].delta === "Ready.",
    "the final text delta should be parsed without a trailing newline",
  );
}

async function testAsyncOrdering(): Promise<void> {
  const seen: string[] = [];
  await consumeNdjsonStream<CoachTurnStreamEvent>(
    chunkedStream([
      '{"type":"text_delta","turn_id":"turn-1","state_version":1,"delta":"one"}\n',
      '{"type":"text_delta","turn_id":"turn-1","state_version":1,"delta":"two"}\n',
    ]),
    async (event) => {
      if (event.type !== "text_delta") return;
      await Promise.resolve();
      seen.push(event.delta);
    },
  );
  assert(seen.join(",") === "one,two", "stream callbacks must complete in wire order");
}

void (async () => {
  await testChunkBoundariesAndFinalLine();
  console.log("✓ parses NDJSON across chunks and final lines");
  await testAsyncOrdering();
  console.log("✓ preserves asynchronous event ordering");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
