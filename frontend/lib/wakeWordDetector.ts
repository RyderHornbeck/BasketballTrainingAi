// On-device wake phrase detection for "Hey Coach".
// Uses expo-speech-recognition and never overlaps with WebRTC mic capture.

import {
  ExpoSpeechRecognitionModule,
} from "expo-speech-recognition";

const WAKE_PATTERNS = [/\bhey[\s,]*coach\b/i, /\bcoach\b/i];

export interface WakeWordDetectorOptions {
  onWake: () => void;
  onUnavailable?: (reason: string) => void;
  onError?: (message: string) => void;
}

export class WakeWordDetector {
  private active = false;
  private listening = false;
  private lastTriggerAt = 0;
  private options: WakeWordDetectorOptions | null = null;
  private resultListener: { remove: () => void } | null = null;
  private errorListener: { remove: () => void } | null = null;
  private endListener: { remove: () => void } | null = null;

  async start(options: WakeWordDetectorOptions): Promise<boolean> {
    if (this.active) return true;
    this.options = options;

    try {
      const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        options.onUnavailable?.("Speech recognition is unavailable on this device.");
        return false;
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        options.onUnavailable?.("Microphone permission is required for wake-word listening.");
        return false;
      }

      this.resultListener = ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const transcript = event.results?.[0]?.transcript ?? "";
        if (!transcript) return;
        if (!WAKE_PATTERNS.some((pattern) => pattern.test(transcript))) return;

        const now = Date.now();
        if (now - this.lastTriggerAt < 2500) return;
        this.lastTriggerAt = now;
        void this.stop();
        options.onWake();
      });

      this.errorListener = ExpoSpeechRecognitionModule.addListener("error", (event) => {
        if (this.active) {
          options.onError?.(event.error ?? "Wake-word listener error.");
        }
      });

      this.endListener = ExpoSpeechRecognitionModule.addListener("end", () => {
        this.listening = false;
        if (this.active) {
          void this.restartRecognition();
        }
      });

      this.active = true;
      await this.restartRecognition();
      return true;
    } catch (err) {
      options.onUnavailable?.(
        err instanceof Error ? err.message : "Wake-word detection failed to start."
      );
      await this.stop();
      return false;
    }
  }

  private async restartRecognition(): Promise<void> {
    if (!this.active || this.listening) return;

    const supportsOnDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition?.() ?? false;

    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: supportsOnDevice,
        contextualStrings: ["Hey Coach", "Coach"],
        iosTaskHint: "confirmation",
      });
      this.listening = true;
    } catch (err) {
      this.options?.onError?.(
        err instanceof Error ? err.message : "Unable to restart wake-word listener."
      );
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.listening = false;

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }

    this.resultListener?.remove();
    this.errorListener?.remove();
    this.endListener?.remove();
    this.resultListener = null;
    this.errorListener = null;
    this.endListener = null;
    this.options = null;
  }
}