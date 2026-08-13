import {
  createClient,
  type InworldTTSClient,
} from "@inworld/tts";

// The HTTP streaming API has no shared prosody context across calls. Sending
// token-sized deltas makes each one a new utterance, which is audible as
// robotic pauses. These thresholds normally keep a full concise Coach reply
// together while still beginning long answers before generation is complete.
const MINIMUM_UTTERANCE_CHARACTERS = 240;
const MAXIMUM_UTTERANCE_WAIT_MS = 450;
export const INITIAL_FIRST_AUDIO_TIMEOUT_MS = 2_000;
export const RETRY_FIRST_AUDIO_TIMEOUT_MS = 3_000;

export interface InworldRequestIdentity {
  clientId: number;
  requestId: string;
  contextId: string;
}

let clientSequence = 0;

export class InworldFirstAudioTimeoutError extends Error {
  constructor(
    readonly contextId: string,
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(`Inworld did not return audio within ${timeoutMs}ms.`);
    this.name = "InworldFirstAudioTimeoutError";
  }
}

export interface InworldTtsOptions {
  accessToken: string;
  refreshAccessToken: () => Promise<string>;
  voiceId: string;
  firstAudioTimeoutMs?: number;
  onAudio: (base64Pcm: string, identity: InworldRequestIdentity) => void;
  onFirstAudio: (identity: InworldRequestIdentity) => void;
  onDone: (contextId: string) => void;
  onBilledCharacters: (count: number) => void;
  onError: (error: Error, identity: InworldRequestIdentity) => void;
  onClose: () => void;
}

export class InworldTtsClient {
  private client: InworldTTSClient | null = null;
  private readonly pendingText = new Map<string, string>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cancelledContexts = new Set<string>();
  private readonly contextQueues = new Map<string, Promise<void>>();
  private contextsWithAudio = new Set<string>();
  private lifetime = 0;
  private requestSequence = 0;
  private readonly firstAudioTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly requestContexts = new Map<string, string>();
  private readonly clientId = ++clientSequence;

  constructor(private readonly options: InworldTtsOptions) {}

  get isOpen(): boolean {
    return this.client !== null;
  }

  connect(): Promise<void> {
    this.close();
    this.lifetime += 1;
    this.client = createClient({
      token: this.options.accessToken,
      onTokenExpiring: this.options.refreshAccessToken,
      timeout: 10_000,
      // Retry transient TLS/network failures before reporting a failed turn.
      // A mobile radio can briefly be between states while the first HTTP
      // stream is opened.
      maxRetries: 2,
    });
    return Promise.resolve();
  }

  createContext(contextId: string): void {
    this.cancelledContexts.delete(contextId);
    this.pendingText.set(contextId, "");
    this.contextQueues.set(contextId, Promise.resolve());
  }

  pushText(contextId: string, text: string, finish = false): void {
    if (!text.trim() || this.cancelledContexts.has(contextId)) return;
    this.pendingText.set(contextId, `${this.pendingText.get(contextId) ?? ""}${text}`);
    if (
      !finish &&
      (this.pendingText.get(contextId)?.length ?? 0) <
        MINIMUM_UTTERANCE_CHARACTERS
    ) {
      if (!this.flushTimers.has(contextId)) {
        this.flushTimers.set(
          contextId,
          setTimeout(
            () => this.flush(contextId, false),
            MAXIMUM_UTTERANCE_WAIT_MS,
          ),
        );
      }
      return;
    }
    this.flush(contextId, finish);
  }

  private flush(contextId: string, final: boolean): void {
    const timer = this.flushTimers.get(contextId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(contextId);
    const text = this.pendingText.get(contextId)?.trim() ?? "";
    this.pendingText.set(contextId, "");
    if (!text) return;
    const previous = this.contextQueues.get(contextId) ?? Promise.resolve();
    const queued = previous
      .then(() => this.streamContext(contextId, text, final))
      .catch(() => undefined);
    this.contextQueues.set(contextId, queued);
  }

  finish(contextId: string): void {
    if (this.cancelledContexts.has(contextId)) return;
    this.flush(contextId, true);
    const previous = this.contextQueues.get(contextId) ?? Promise.resolve();
    this.contextQueues.set(
      contextId,
      previous.then(() => {
        this.contextsWithAudio.delete(contextId);
        this.options.onDone(contextId);
      }),
    );
  }

  cancel(contextId: string): void {
    this.cancelledContexts.add(contextId);
    const timer = this.flushTimers.get(contextId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(contextId);
    this.pendingText.delete(contextId);
    this.contextQueues.delete(contextId);
    this.contextsWithAudio.delete(contextId);
    for (const [requestId, requestContextId] of this.requestContexts) {
      if (requestContextId !== contextId) continue;
      const timer = this.firstAudioTimers.get(requestId);
      if (timer) clearTimeout(timer);
      this.firstAudioTimers.delete(requestId);
      this.requestContexts.delete(requestId);
    }
  }

  close(): void {
    this.lifetime += 1;
    this.client = null;
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.pendingText.clear();
    this.contextQueues.clear();
    this.cancelledContexts.clear();
    this.contextsWithAudio.clear();
    for (const timer of this.firstAudioTimers.values()) clearTimeout(timer);
    this.firstAudioTimers.clear();
    this.requestContexts.clear();
  }

  private async streamContext(
    contextId: string,
    text: string,
    final: boolean,
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    const lifetime = this.lifetime;
    const requestId = `${lifetime}:${++this.requestSequence}`;
    const identity: InworldRequestIdentity = {
      clientId: this.clientId,
      requestId,
      contextId,
    };
    const clearFirstAudioTimeout = () => {
      const timer = this.firstAudioTimers.get(requestId);
      if (timer) clearTimeout(timer);
      this.firstAudioTimers.delete(requestId);
      this.requestContexts.delete(requestId);
    };
    this.requestContexts.set(requestId, contextId);
    this.firstAudioTimers.set(
      requestId,
      setTimeout(() => {
        if (
          this.lifetime === lifetime &&
          this.client === client &&
          !this.cancelledContexts.has(contextId) &&
          !this.contextsWithAudio.has(contextId)
        ) {
          this.cancel(contextId);
          this.options.onError(
            new InworldFirstAudioTimeoutError(
              contextId,
              requestId,
              this.options.firstAudioTimeoutMs ?? INITIAL_FIRST_AUDIO_TIMEOUT_MS,
            ),
            identity,
          );
        }
      }, this.options.firstAudioTimeoutMs ?? INITIAL_FIRST_AUDIO_TIMEOUT_MS),
    );
    try {
      const requestText =
        `[warm supportive basketball coach with natural conversational pacing and brief pauses between thoughts] ${text}`;
      this.options.onBilledCharacters(requestText.length);
      for await (const audio of client.stream({
        // TTS-2 interprets this steering tag instead of voicing it. Keeping the
        // direction transport-side makes every streamed phrase consistent
        // without requiring Haiku to emit provider-specific markup.
        text: requestText,
        voice: this.options.voiceId,
        model: "inworld-tts-2",
        encoding: "PCM",
        sampleRate: 16000,
        language: "en-US",
        speakingRate: 1.08,
        deliveryMode: "BALANCED",
      })) {
        if (
          this.lifetime !== lifetime ||
          this.client !== client ||
          this.cancelledContexts.has(contextId)
        ) return;
        if (!this.contextsWithAudio.has(contextId)) {
          clearFirstAudioTimeout();
          this.contextsWithAudio.add(contextId);
          this.options.onFirstAudio(identity);
        }
        this.options.onAudio(bytesToBase64(audio), identity);
      }
      clearFirstAudioTimeout();
      if (final && !this.cancelledContexts.has(contextId)) this.finish(contextId);
    } catch (error) {
      clearFirstAudioTimeout();
      if (this.lifetime === lifetime && !this.cancelledContexts.has(contextId)) {
        this.options.onError(
          error instanceof Error ? error : new Error("Inworld TTS request failed."),
          identity,
        );
      }
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return globalThis.btoa(binary);
}
