import { gateShotEvent } from "./shotEventSeam";

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

test("voice shots remain active in voice mode", () => {
  equal(gateShotEvent("voice", "voice", "voice-1", new Set()).status, "accepted");
});

test("voice shots are consumed in video mode", () => {
  const seen = new Set<string>();
  const result = gateShotEvent("video", "voice", "voice-1", seen);
  equal(result.status, "ignored");
  equal(seen.size, 0);
});

test("late video shots are consumed after returning to voice mode", () => {
  const seen = new Set<string>();
  const result = gateShotEvent("voice", "video", "camera-late", seen);
  equal(result.status, "ignored");
  equal(seen.size, 0);
});

test("video event ids are deduplicated without time windows", () => {
  const seen = new Set<string>();
  equal(gateShotEvent("video", "video", "camera-42", seen).status, "accepted");
  equal(gateShotEvent("video", "video", "camera-42", seen).status, "duplicate");
  equal(gateShotEvent("video", "video", "camera-43", seen).status, "accepted");
});
