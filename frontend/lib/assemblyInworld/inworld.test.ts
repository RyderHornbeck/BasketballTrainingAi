import { InworldTtsClient } from "./inworld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeWebSocket {
  static OPEN = 1;
  static latest: FakeWebSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly _protocols?: string | string[],
    readonly options?: { headers?: Record<string, string> },
  ) {
    FakeWebSocket.latest = this;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const originalWebSocket = globalThis.WebSocket;
(globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;

try {
  const audio: string[] = [];
  const completed: string[] = [];
  const client = new InworldTtsClient({
    accessToken: "jwt",
    refreshAccessToken: async () => "new-jwt",
    voiceId: "voice",
    onAudio: (pcm) => audio.push(pcm),
    onFirstAudio: () => undefined,
    onDone: (contextId) => completed.push(contextId),
    onBilledCharacters: () => undefined,
    onError: (error) => {
      throw error;
    },
    onClose: () => undefined,
  });
  const connecting = client.connect();
  const socket = FakeWebSocket.latest!;
  assert(
    socket.options?.headers?.Authorization === "Bearer jwt",
    "WebSocket must use the short-lived bearer token",
  );
  socket.open();
  void connecting;
  client.createContext("turn-1");
  client.pushText("turn-1", "Set one is ready.");

  const sent = socket.sent.map((message) => JSON.parse(message));
  assert(sent[0].create.audioConfig.audioEncoding === "PCM", "context must request PCM");
  assert(sent[0].create.audioConfig.sampleRateHertz === 16000, "context must request 16 kHz");
  assert(sent[1].send_text.flush_context, "each local text flush must start synthesis");

  socket.message({
    result: {
      contextId: "other-turn",
      audioChunk: { audioContent: "c3RhbGU=" },
    },
  });
  assert(audio.length === 0, "audio for an unknown context must be ignored");

  socket.message({
    result: {
      contextId: "turn-1",
      audioChunk: { audioContent: "cGNt" },
    },
  });
  socket.message({ result: { contextId: "turn-1", flushCompleted: {} } });
  const messagesBeforeFinish = socket.sent.length;
  client.finish("turn-1");
  assert(
    socket.sent.length === messagesBeforeFinish,
    "finishing an already flushed context must not synthesize it again",
  );
  socket.message({ result: { contextId: "turn-1", flushCompleted: {} } });
  assert(audio[0] === "cGNt", "PCM base64 must be forwarded unchanged");
  assert(completed[0] === "turn-1", "final flush must complete the context");

  client.createContext("turn-2");
  client.pushText("turn-2", "First phrase. ".repeat(20));
  client.pushText("turn-2", "Final sentence.", true);
  const turnTwoMessagesBeforeFirstFlushCompletes = socket.sent
    .map((message) => JSON.parse(message))
    .filter((message) => message.contextId === "turn-2" && message.send_text);
  assert(
    turnTwoMessagesBeforeFirstFlushCompletes.length === 1,
    "a later phrase must wait for the prior flush to complete",
  );
  socket.message({
    result: {
      contextId: "turn-2",
      audioChunk: { audioContent: "Zmlyc3Q=" },
    },
  });
  socket.message({ result: { contextId: "turn-2", flushCompleted: {} } });
  const turnTwoMessagesAfterFirstFlushCompletes = socket.sent
    .map((message) => JSON.parse(message))
    .filter((message) => message.contextId === "turn-2" && message.send_text);
  assert(
    turnTwoMessagesAfterFirstFlushCompletes.length === 2,
    "the final phrase must flush after the earlier phrase completes",
  );
  socket.message({
    result: {
      contextId: "turn-2",
      audioChunk: { audioContent: "bGFzdA==" },
    },
  });
  socket.message({ result: { contextId: "turn-2", flushCompleted: {} } });
  assert(
    audio.at(-1) === "bGFzdA==",
    "final phrase PCM must be forwarded before the context completes",
  );
  assert(completed.at(-1) === "turn-2", "the final phrase must complete the context");
  console.log("✓ Inworld WebSocket protocol routes PCM by context");
} finally {
  (globalThis as unknown as { WebSocket: typeof originalWebSocket }).WebSocket = originalWebSocket;
}
