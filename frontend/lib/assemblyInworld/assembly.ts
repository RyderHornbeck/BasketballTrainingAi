export const ASSEMBLY_WS_URL = "wss://streaming.assemblyai.com/v3/ws";

export interface AssemblyTurn {
  turnOrder: number;
  transcript: string;
  endOfTurn: boolean;
}

export interface AssemblyClientOptions {
  accessToken: string;
  keyterms: readonly string[];
  prompt: string;
  agentContext?: string;
  voiceFocus: "near-field" | "far-field";
  onSpeechStarted: () => void;
  onPartial: (transcript: string) => void;
  onTurn: (turn: AssemblyTurn) => void;
  onError: (error: Error) => void;
  onClose: (error: Error) => void;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function boundedKeyterms(keyterms: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of keyterms) {
    const term = candidate.trim().slice(0, 50);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length === 100) break;
  }
  return result;
}

export class AssemblyRealtimeClient {
  private socket: WebSocket | null = null;
  private opened = false;
  private pendingAudio: Uint8Array[] = [];
  private pendingAudioBytes = 0;

  constructor(private readonly options: AssemblyClientOptions) {}

  get isOpen(): boolean {
    return this.opened && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    this.close();
    const params = new URLSearchParams({
      token: this.options.accessToken,
      speech_model: "universal-3-5-pro",
      mode: "min_latency",
      language_codes: JSON.stringify(["en"]),
      encoding: "pcm_s16le",
      sample_rate: "16000",
      min_turn_silence: "100",
      max_turn_silence: "800",
      include_partial_turns: "true",
      continuous_partials: "true",
      prompt: this.options.prompt.slice(0, 1_750),
      agent_context: (this.options.agentContext ?? "").slice(0, 1_750),
      voice_focus: this.options.voiceFocus,
      keyterms_prompt: JSON.stringify(boundedKeyterms(this.options.keyterms)),
    });
    const socket = new WebSocket(`${ASSEMBLY_WS_URL}?${params.toString()}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("AssemblyAI streaming connection timed out."));
        socket.close();
      }, 10_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        this.opened = true;
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        if (!this.opened) reject(new Error("AssemblyAI streaming connection failed."));
        else this.options.onError(new Error("AssemblyAI streaming error."));
      };
      socket.onclose = (event: { code?: number; reason?: string }) => {
        const wasOpen = this.opened;
        this.opened = false;
        if (wasOpen) {
          const detail = [event.code ? `code ${event.code}` : null, event.reason]
            .filter(Boolean)
            .join(": ");
          this.options.onClose(
            new Error(`AssemblyAI streaming socket closed${detail ? ` (${detail})` : ""}.`),
          );
        }
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  sendAudio(base64Pcm: string): void {
    if (!this.isOpen) return;
    const frame = base64ToBytes(base64Pcm);
    this.pendingAudio.push(frame);
    this.pendingAudioBytes += frame.byteLength;
    // AssemblyAI's current v3 protocol requires raw chunks between 50 and
    // 1,000 ms. The duplex module emits 20 ms frames, so send three at once.
    if (this.pendingAudioBytes < 1_600) return; // 50 ms of 16 kHz PCM16.
    const audio = new Uint8Array(this.pendingAudioBytes);
    let offset = 0;
    for (const chunk of this.pendingAudio) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    this.socket?.send(audio.buffer);
  }

  updateAgentContext(agentContext: string): void {
    this.sendConfiguration({ agent_context: agentContext.slice(0, 1_750) });
  }

  updateKeyterms(keyterms: readonly string[]): void {
    this.sendConfiguration({ keyterms_prompt: boundedKeyterms(keyterms) });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.opened = false;
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.send(JSON.stringify({ type: "Terminate" }));
      socket.close();
    }
  }

  private sendConfiguration(configuration: Record<string, unknown>): void {
    if (!this.isOpen) return;
    this.socket?.send(JSON.stringify({ type: "UpdateConfiguration", ...configuration }));
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    try {
      const message = JSON.parse(data) as {
        type?: string;
        turn_order?: number;
        transcript?: string;
        utterance?: string;
        end_of_turn?: boolean;
        error?: string;
      };
      if (message.type === "SpeechStarted") {
        this.options.onSpeechStarted();
        return;
      }
      if (message.type === "Turn") {
        const transcript = (message.end_of_turn
          ? message.utterance || message.transcript
          : message.transcript) ?? "";
        if (!message.end_of_turn && transcript.trim()) this.options.onPartial(transcript);
        if (message.end_of_turn && transcript.trim()) {
          this.options.onTurn({
            turnOrder: message.turn_order ?? 0,
            transcript: transcript.trim(),
            endOfTurn: true,
          });
        }
        return;
      }
      if (message.type === "Error") {
        this.options.onError(new Error(message.error || "AssemblyAI streaming failed."));
      }
    } catch {
      this.options.onError(new Error("AssemblyAI sent an invalid streaming event."));
    }
  }
}
