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
  SonicAudioLruCache,
  buildSonicAudioCacheKey,
  buildSonicGenerationRequest,
  buildSonicWebSocketUrl,
  drainSonicTextChunks,
  gateCoachSpeechText,
  parseSonicServerEvent,
  sanitizeCoachSpeechText,
  takeSonicTextChunk,
  type SonicAudioCacheKey,
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
    turn: { endTimeoutMs: 640 },
  }));
  assert.equal(url.origin, "wss://api.cartesia.ai");
  assert.equal(url.pathname, "/stt/turns/websocket");
  assert.equal(url.searchParams.get("model"), "ink-2");
  assert.equal(url.searchParams.get("cartesia_version"), CARTESIA_API_VERSION);
  assert.equal(url.searchParams.get("access_token"), "short lived/+");
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["free throw", "Cartesia"]);
  assert.equal(url.searchParams.get("turn_end_timeout_ms"), "640");
  assert.throws(
    () =>
      buildInkWebSocketUrl({
        accessToken: "token",
        encoding: "pcm_s16le",
        sampleRate: 16000,
        turn: { endTimeoutMs: 639 },
      }),
    "invalid_configuration",
  );
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

test("streams Sonic text on early word and punctuation boundaries", () => {
  assert.deepEqual(takeSonicTextChunk("Set one is now thirty seconds and counting ", false), {
    chunk: "Set one is now thirty seconds and counting ",
    remainder: "",
  });
  assert.deepEqual(takeSonicTextChunk("seconds. Next up", false), {
    chunk: "seconds. ",
    remainder: "Next up",
  });
  assert.deepEqual(takeSonicTextChunk("short", false), {
    chunk: "",
    remainder: "short",
  });
});

test("drains every complete Sonic phrase and preserves exact input", () => {
  const input = 'First phrase,  then 3.5 seconds. Next phrase! "Partial';
  const result = drainSonicTextChunks(input, false);
  assert.deepEqual(result, {
    chunks: ["First phrase,  ", "then 3.5 seconds. ", "Next phrase! "],
    remainder: '"Partial',
  });
  assert.equal(result.chunks.join("") + result.remainder, input);
});

test("keeps decimal points inside Sonic phrases", () => {
  assert.deepEqual(drainSonicTextChunks("Hold for 2.5 seconds. Then go", false), {
    chunks: ["Hold for 2.5 seconds. "],
    remainder: "Then go",
  });
  assert.deepEqual(drainSonicTextChunks("The target is 3.14159", false), {
    chunks: [],
    remainder: "The target is 3.14159",
  });
});

test("uses word-safe fallback chunks without emitting tiny fragments", () => {
  const completeWords = "Set one is now thirty seconds and counting ";
  assert.deepEqual(drainSonicTextChunks(completeWords, false), {
    chunks: [completeWords],
    remainder: "",
  });
  const longUnbrokenWord = "supercalifragilisticexpialidociousandstillstreaming";
  assert.deepEqual(drainSonicTextChunks(longUnbrokenWord, false), {
    chunks: [],
    remainder: longUnbrokenWord,
  });
  assert.deepEqual(drainSonicTextChunks("tiny boundary followedbyaverylongtoken", false, 16), {
    chunks: [],
    remainder: "tiny boundary followedbyaverylongtoken",
  });
  const stalledPhrase = "word ".repeat(30);
  const bounded = drainSonicTextChunks(stalledPhrase, false, 20, 40);
  assert.equal(bounded.chunks.length, 1);
  assert.equal(bounded.chunks[0], "word ".repeat(8));
  assert.equal(bounded.chunks[0].length >= 20, true);
  assert.equal(bounded.chunks[0].length <= 40, true);
  assert.equal(bounded.chunks.join("") + bounded.remainder, stalledPhrase);
});

test("supports looping over one Sonic chunk at a time", () => {
  let remainder = "One. Two? Three; unfinished";
  const chunks: string[] = [];
  while (true) {
    const next = takeSonicTextChunk(remainder, false);
    if (!next.chunk) break;
    chunks.push(next.chunk);
    remainder = next.remainder;
  }
  assert.deepEqual(chunks, ["One. ", "Two? ", "Three; "]);
  assert.equal(remainder, "unfinished");
  assert.deepEqual(drainSonicTextChunks(remainder, true), {
    chunks: ["unfinished"],
    remainder: "",
  });
});

const cacheKey: SonicAudioCacheKey = {
  finalText: "Stay low.",
  voiceId: "voice-1",
  locale: "en-US",
  codec: "pcm_s16le",
  sampleRate: 24000,
  speed: 1,
  emotion: "determined",
  rendererVersion: "sonic-renderer-v1",
};

test("builds Sonic cache keys from every rendering input", () => {
  const base = buildSonicAudioCacheKey(cacheKey);
  const differences: SonicAudioCacheKey[] = [
    { ...cacheKey, finalText: "Stay low!" },
    { ...cacheKey, voiceId: "voice-2" },
    { ...cacheKey, locale: "es-MX" },
    { ...cacheKey, codec: "pcm_f32le" },
    { ...cacheKey, sampleRate: 48000 },
    { ...cacheKey, speed: 1.1 },
    { ...cacheKey, emotion: "calm" },
    { ...cacheKey, rendererVersion: "sonic-renderer-v2" },
  ];
  for (const difference of differences) {
    assert.equal(buildSonicAudioCacheKey(difference) === base, false);
  }
  assert.equal(buildSonicAudioCacheKey({ ...cacheKey }), base);
});

test("evicts least-recently-used Sonic audio and copies byte buffers", () => {
  const cache = new SonicAudioLruCache({ maxEntries: 2, maxBytes: 16 });
  const secondKey = { ...cacheKey, finalText: "Second." };
  const thirdKey = { ...cacheKey, finalText: "Third." };
  const firstAudio = new Uint8Array([1, 2, 3]);
  cache.set(cacheKey, firstAudio);
  cache.set(secondKey, new Uint8Array([4, 5]));
  firstAudio[0] = 99;
  const cachedFirst = cache.get(cacheKey);
  assert.deepEqual(cachedFirst ? [...cachedFirst] : undefined, [1, 2, 3]);
  if (cachedFirst) cachedFirst[1] = 99;

  cache.set(thirdKey, new Uint8Array([6]));
  assert.equal(cache.has(cacheKey), true);
  assert.equal(cache.has(secondKey), false);
  assert.equal(cache.has(thirdKey), true);
  const cachedFirstAgain = cache.get(cacheKey);
  assert.deepEqual(cachedFirstAgain ? [...cachedFirstAgain] : undefined, [1, 2, 3]);
  assert.equal(cache.size, 2);
  assert.equal(cache.byteLength, 4);
});

test("bounds Sonic audio cache by bytes and skips oversized entries", () => {
  const cache = new SonicAudioLruCache({ maxEntries: 4, maxBytes: 5 });
  const secondKey = { ...cacheKey, finalText: "Second." };
  cache.set(cacheKey, new Uint8Array([1, 2, 3]));
  cache.set(secondKey, new Uint8Array([4, 5, 6]));
  assert.equal(cache.has(cacheKey), false);
  assert.equal(cache.has(secondKey), true);
  cache.set(cacheKey, new Uint8Array(6));
  assert.equal(cache.has(cacheKey), false);
  assert.equal(cache.byteLength, 3);
});

test("sanitizes model text into natural spoken language", () => {
  assert.equal(
    sanitizeCoachSpeechText("**Progress:** 4/6 = 67% & improving"),
    "Progress: 4 for 6 equals 67 percent and improving",
  );
  assert.equal(
    sanitizeCoachSpeechText("Option A / Option B"),
    "Option A or Option B",
  );
});

test("holds split JSON and suppresses internal tool syntax before speech", () => {
  assert.equal(gateCoachSpeechText("{", false).status, "hold");
  assert.equal(
    gateCoachSpeechText("function call = invoke search_exercise_catalog", true).status,
    "unsafe",
  );
  assert.equal(
    gateCoachSpeechText('{"name":"record_make","arguments":{"makes":1}}', false).status,
    "unsafe",
  );
  assert.equal(
    gateCoachSpeechText('data: {"type":"response.output_text.delta"}', true).status,
    "unsafe",
  );
  assert.equal(
    gateCoachSpeechText('record_make({"exercise_id":"abc","makes":1})', true).status,
    "unsafe",
  );
  assert.equal(
    gateCoachSpeechText('<tool_use name="get_progress">', true).status,
    "unsafe",
  );
});

test("speech safety gate preserves normal basketball coaching language", () => {
  const result = gateCoachSpeechText(
    "Great work—you're 4/6. Keep your off hand quiet, call out switch, and attack the gap.",
    true,
  );
  assert.equal(result.status, "safe");
  assert.equal(
    result.speech,
    "Great work—you're 4 for 6. Keep your off hand quiet, call out switch, and attack the gap.",
  );
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
