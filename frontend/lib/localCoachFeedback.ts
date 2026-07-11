// Short local confirmations for deterministic coach tool results.

import * as Speech from "expo-speech";

let speaking = false;

export async function speakLocalConfirmation(message: string): Promise<void> {
  const text = message.trim();
  if (!text) return;

  try {
    if (speaking) {
      Speech.stop();
    }
    speaking = true;
    await new Promise<void>((resolve) => {
      Speech.speak(text, {
        language: "en-US",
        rate: 1.02,
        pitch: 1,
        onDone: () => {
          speaking = false;
          resolve();
        },
        onStopped: () => {
          speaking = false;
          resolve();
        },
        onError: () => {
          speaking = false;
          resolve();
        },
      });
    });
  } catch (err) {
    speaking = false;
    console.warn("Local coach confirmation failed:", err);
  }
}

export function stopLocalConfirmation(): void {
  try {
    Speech.stop();
  } catch {
    // Ignore.
  }
  speaking = false;
}
