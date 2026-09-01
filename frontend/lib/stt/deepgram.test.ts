import {
  DeepgramRealtimeClient,
  LocalVadAudioGate,
  type PcmFrame,
} from "./deepgram";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(run()).then(() => console.log(`✓ ${name}`));
}

class FakeSocket {
  readyState: number = 0;
  binaryType: BinaryType = "blob";
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

function frame(id: number, frames = 320): PcmFrame {
  const bytes = new Uint8Array(frames * 2);
  bytes[0] = id;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { data: btoa(binary), frames, sampleRate: 16_000 };
}

async function main(): Promise<void> {
await test("400 ms prebuffer is delivered once and in chronological order", () => {
  const gate = new LocalVadAudioGate(400);
  for (let id = 1; id <= 25; id += 1) gate.accept(frame(id));
  const buffered = gate.speechStarted();
  assert(buffered.length === 20, `expected 20 frames, received ${buffered.length}`);
  assert(buffered[0].data === frame(6).data, "oldest retained frame is out of order");
  assert(buffered[19].data === frame(25).data, "newest retained frame is out of order");
  assert(gate.speechStarted().length === 0, "prebuffer was delivered more than once");
});

await test("idle VAD sends no PCM and streaming retains trailing silence", () => {
  const gate = new LocalVadAudioGate();
  assert(gate.accept(frame(1)).length === 0, "idle frame escaped the VAD gate");
  gate.speechStarted();
  assert(gate.accept(frame(2)).length === 1, "speech frame was not sent");
  assert(gate.accept(frame(0)).length === 1, "trailing silence stopped before provider final");
  gate.completeTurn();
  assert(gate.accept(frame(3)).length === 0, "gate did not return to idle");
});

await test("Deepgram sends KeepAlive while idle and cleans up its socket", async () => {
  const socket = new FakeSocket();
  const client = new DeepgramRealtimeClient({
    accessToken: "temporary",
    keepAliveMs: 5,
    socketFactory: () => socket as unknown as WebSocket,
    onSpeechStarted: () => undefined,
    onPartial: () => undefined,
    onTurn: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  });
  const connected = client.connect();
  socket.open();
  await connected;
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert(
    socket.sent.some((item) => item === JSON.stringify({ type: "KeepAlive" })),
    "idle socket did not receive KeepAlive",
  );
  client.close();
  assert(
    socket.sent.includes(JSON.stringify({ type: "CloseStream" })),
    "cleanup did not send CloseStream",
  );
  assert(socket.readyState === 3, "cleanup did not close the socket");
});

await test("final segments aggregate once while partials remain provisional", async () => {
  const socket = new FakeSocket();
  const partials: string[] = [];
  const turns: string[] = [];
  let duplicateTurns = 0;
  const client = new DeepgramRealtimeClient({
    accessToken: "temporary",
    socketFactory: () => socket as unknown as WebSocket,
    onSpeechStarted: () => undefined,
    onPartial: (turn) => partials.push(turn.transcript),
    onTurn: (turn) => turns.push(turn.transcript),
    onError: (error) => {
      throw error;
    },
    onClose: () => undefined,
    onDuplicateTurn: () => {
      duplicateTurns += 1;
    },
  });
  const connected = client.connect();
  socket.open();
  await connected;
  socket.message({
    type: "Results",
    start: 0,
    duration: 0.5,
    is_final: false,
    speech_final: false,
    channel: { alternatives: [{ transcript: "set a" }] },
  });
  assert(partials.length === 1 && turns.length === 0, "partial created a completed turn");
  socket.message({
    type: "Results",
    start: 0,
    duration: 0.5,
    is_final: true,
    speech_final: false,
    channel: { alternatives: [{ transcript: "set a" }] },
  });
  socket.message({
    type: "Results",
    start: 0.5,
    duration: 0.8,
    is_final: true,
    speech_final: true,
    channel: { alternatives: [{ transcript: "two minute timer" }] },
  });
  assert(turns[0] === "set a two minute timer", "final segments were not combined");
  socket.message({
    type: "Results",
    start: 0.5,
    duration: 0.8,
    is_final: true,
    speech_final: true,
    channel: { alternatives: [{ transcript: "two minute timer" }] },
  });
  assert(Number(turns.length) === 1, "duplicate completed turn escaped");
  assert(Number(duplicateTurns) === 1, "duplicate telemetry was not recorded");
  socket.message({
    type: "Results",
    start: 2,
    duration: 0.2,
    is_final: true,
    speech_final: true,
    channel: { alternatives: [{ transcript: "make" }] },
  });
  socket.message({
    type: "Results",
    start: 3,
    duration: 0.2,
    is_final: true,
    speech_final: true,
    channel: { alternatives: [{ transcript: "make" }] },
  });
  assert(Number(turns.length) === 3, "legitimate repeated commands were suppressed");
  client.close();
});

await test("Finalize recovery is a text control message", async () => {
  const socket = new FakeSocket();
  const client = new DeepgramRealtimeClient({
    accessToken: "temporary",
    socketFactory: () => socket as unknown as WebSocket,
    onSpeechStarted: () => undefined,
    onPartial: () => undefined,
    onTurn: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  });
  const connected = client.connect();
  socket.open();
  await connected;
  client.finalize();
  assert(
    socket.sent.includes(JSON.stringify({ type: "Finalize" })),
    "watchdog recovery did not send Finalize",
  );
  client.close();
});
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
