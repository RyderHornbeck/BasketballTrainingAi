import {
  INITIAL_INK_TURN_STATE,
  buildInkWebSocketUrl,
  parseInkServerEvent,
  transitionInkTurn,
} from "./ink";
import {
  CARTESIA_API_VERSION,
  CartesiaTransportError,
  audioToArrayBuffer,
  decodeBase64,
} from "./protocol";
import {
  buildSonicGenerationRequest,
  buildSonicWebSocketUrl,
  parseSonicServerEvent,
} from "./sonic";
import { shouldAcceptTurnEvent } from "./sequencing";

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
  throws(run: () => void, code: string): void {
    try {
      run();
    } catch (error) {
      if (error instanceof CartesiaTransportError && error.code === code) return;
      throw error;
    }
    fail(`Expected CartesiaTransportError with code "${code}"`);
  },
};

function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}

test("builds an Ink-2 short-lived-token URL", () => {
  const url = new URL(buildInkWebSocketUrl({
    accessToken: "short lived/+",
    encoding: "pcm_s16le",
    sampleRate: 16000,
    keyterms: ["free throw", "Cartesia"],
  }));
  assert.equal(url.origin, "wss://api.cartesia.ai");
  assert.equal(url.pathname, "/stt/turns/websocket");
  assert.equal(url.searchParams.get("model"), "ink-2");
  assert.equal(url.searchParams.get("cartesia_version"), CARTESIA_API_VERSION);
  assert.equal(url.searchParams.get("access_token"), "short lived/+");
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["free throw", "Cartesia"]);
});

test("parses all Ink lifecycle event shapes", () => {
  assert.equal(parseInkServerEvent('{"type":"turn.start","request_id":"r"}').type, "turn.start");
  assert.equal(
    parseInkServerEvent(
      '{"type":"turn.update","transcript":"drive left","request_id":"r"}',
    ).type,
    "turn.update",
  );
  assert.equal(
    parseInkServerEvent(
      '{"type":"turn.eager_end","transcript":"drive left","request_id":"r"}',
    ).type,
    "turn.eager_end",
  );
  assert.equal(parseInkServerEvent('{"type":"turn.resume","request_id":"r"}').type, "turn.resume");
  assert.equal(
    parseInkServerEvent(
      '{"type":"turn.end","transcript":"drive left","request_id":"r"}',
    ).type,
    "turn.end",
  );
});

test("deduplicates repeated final events within an Ink turn", () => {
  const start = parseInkServerEvent('{"type":"turn.start","request_id":"r"}');
  const end = parseInkServerEvent('{"type":"turn.end","transcript":"shoot","request_id":"r"}');
  const started = transitionInkTurn(INITIAL_INK_TURN_STATE, start);
  const firstFinal = transitionInkTurn(started.state, end);
  const duplicateFinal = transitionInkTurn(firstFinal.state, end);
  assert.equal(firstFinal.deliverFinal, true);
  assert.equal(duplicateFinal.deliverFinal, false);
  assert.equal(firstFinal.state.turnEpoch, 1);
});

test("decodes base64 audio without Node Buffer or atob", () => {
  assert.deepEqual([...decodeBase64("AQID/v8=")], [1, 2, 3, 254, 255]);
  assert.deepEqual([...new Uint8Array(audioToArrayBuffer("AQI"))], [1, 2]);
  assert.throws(() => decodeBase64("%%%"), "invalid_base64");
});

test("builds Sonic 3.5 continuation and token payloads", () => {
  const url = new URL(buildSonicWebSocketUrl("temporary-token"));
  assert.equal(url.pathname, "/tts/websocket");
  assert.equal(url.searchParams.get("cartesia_version"), CARTESIA_API_VERSION);
  assert.equal(url.searchParams.get("access_token"), "temporary-token");

  const request = buildSonicGenerationRequest(
    "context-1",
    {
      voiceId: "voice-1",
      encoding: "pcm_s16le",
      sampleRate: 24000,
      language: "en",
    },
    "Keep going",
    true,
  );
  assert.equal(request.model_id, "sonic-3.5");
  assert.equal(request.context_id, "context-1");
  assert.equal(request.continue, true);
  assert.equal(request.output_format.container, "raw");
});

test("parses Sonic audio chunks into React Native friendly bytes", () => {
  const event = parseSonicServerEvent(JSON.stringify({
    type: "chunk",
    data: "AAEC",
    done: false,
    status_code: 206,
    step_time: 12,
    context_id: "context-1",
  }));
  if (event.type !== "chunk") fail("Expected chunk");
  assert.deepEqual([...event.audio], [0, 1, 2]);
  assert.equal(event.contextId, "context-1");
});

test("rejects malformed and unknown provider messages", () => {
  assert.throws(() => parseInkServerEvent('{"type":"turn.end","request_id":"r"}'), "invalid_message");
  assert.throws(() => parseSonicServerEvent('{"type":"mystery"}'), "invalid_message");
});

test("rejects stale turn, interruption, and state-version events", () => {
  const guard = { turnId: "turn-2", speechEpoch: 4, stateVersion: 9 };
  assert.equal(
    shouldAcceptTurnEvent(guard, {
      turnId: "turn-2",
      speechEpoch: 4,
      stateVersion: 9,
    }),
    true
  );
  assert.equal(
    shouldAcceptTurnEvent(guard, {
      turnId: "turn-1",
      speechEpoch: 4,
      stateVersion: 9,
    }),
    false
  );
  assert.equal(
    shouldAcceptTurnEvent(guard, {
      turnId: "turn-2",
      speechEpoch: 3,
      stateVersion: 9,
    }),
    false
  );
  assert.equal(
    shouldAcceptTurnEvent(guard, {
      turnId: "turn-2",
      speechEpoch: 4,
      stateVersion: 8,
    }),
    false
  );
});
