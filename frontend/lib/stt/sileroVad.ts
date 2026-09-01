import { Asset } from "expo-asset";

import type { PcmFrame } from "./deepgram";
import sileroVadModel from "../../assets/models/silero_vad.onnx";

type NitroVadInstance = {
  start(callbacks: {
    onSpeechStart: () => void;
    onSpeechEnd: (audio: ArrayBuffer) => void;
  }): () => void;
  processChunk(samples: ArrayBuffer): void;
  reset(): void;
  destroy(): void;
};

export interface LocalVadCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
}

function nativeModelPath(uri: string): string {
  const path = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function pcm16Base64ToFloat32Buffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const sampleCount = Math.floor(binary.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const unsigned =
      binary.charCodeAt(index * 2) |
      (binary.charCodeAt(index * 2 + 1) << 8);
    const signed = unsigned & 0x8000 ? unsigned - 0x10000 : unsigned;
    samples[index] = signed / 32_768;
  }
  return samples.buffer;
}

export class SileroLocalVad {
  private vad: NitroVadInstance | null = null;
  private stopCallbacks: (() => void) | null = null;

  async start(callbacks: LocalVadCallbacks): Promise<void> {
    await this.stop();
    const model = await Asset.fromModule(sileroVadModel).downloadAsync();
    const modelUri = model.localUri ?? model.uri;
    if (!modelUri) throw new Error("The bundled Silero VAD model is unavailable.");
    // Expo Asset returns a file:// URI, while sherpa-onnx expects a native
    // filesystem path and cannot open the URI form on iOS.
    const modelPath = nativeModelPath(modelUri);
    const { NitroVAD } = await import("react-native-nitro-voice");
    const vad = await NitroVAD.create({
      modelPath,
      threshold: 0.6,
      minSpeechDuration: 0.12,
      minSilenceDuration: 0.4,
    });
    this.vad = vad;
    this.stopCallbacks = vad.start({
      onSpeechStart: callbacks.onSpeechStart,
      onSpeechEnd: () => callbacks.onSpeechEnd(),
    });
  }

  process(frame: PcmFrame): void {
    if (!this.vad || frame.sampleRate !== 16_000) return;
    this.vad.processChunk(pcm16Base64ToFloat32Buffer(frame.data));
  }

  reset(): void {
    this.vad?.reset();
  }

  async stop(): Promise<void> {
    this.stopCallbacks?.();
    this.stopCallbacks = null;
    this.vad?.destroy();
    this.vad = null;
  }
}
