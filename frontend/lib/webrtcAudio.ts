// iOS/Android call-audio routing for WebRTC voice sessions.
// Prefers Bluetooth/headphones when connected; does NOT force speakerphone.

import { Platform } from "react-native";

export type VoiceAudioProfile = "bluetooth" | "speaker";

let active = false;

async function loadInCallManager() {
  try {
    const mod = await import("react-native-incall-manager");
    return mod.default;
  } catch (err) {
    console.warn("InCallManager unavailable:", err);
    return null;
  }
}

/** Configure OS audio session for a live voice coach call. */
export async function startVoiceCallAudio(): Promise<VoiceAudioProfile> {
  if (active) return "bluetooth";

  let profile: VoiceAudioProfile = "bluetooth";

  const InCallManager = await loadInCallManager();
  if (InCallManager) {
    // auto: true lets iOS/Android pick the active route (Bluetooth when paired).
    InCallManager.start({ media: "audio", auto: true, ringback: "" });

    if (Platform.OS === "android") {
      try {
        const route = await InCallManager.chooseAudioRoute("BLUETOOTH");
        const selected = route?.selectedAudioDevice as string | undefined;
        profile = selected === "BLUETOOTH" ? "bluetooth" : "speaker";
      } catch {
        profile = "speaker";
      }
    } else {
      // Do not force speaker — iOS routes to Bluetooth/AirPods when connected.
    }
  }

  if (Platform.OS === "ios") {
    try {
      const { RTCAudioSession } = await import("react-native-webrtc");
      RTCAudioSession.audioSessionDidActivate();
    } catch (err) {
      console.warn("RTCAudioSession activation failed:", err);
    }
  }

  active = true;
  return profile;
}

/** Tear down call-audio routing when the coach session ends. */
export async function stopVoiceCallAudio(): Promise<void> {
  if (!active) return;

  const InCallManager = await loadInCallManager();
  if (InCallManager) {
    try {
      InCallManager.stop();
    } catch {
      // Already stopped.
    }
  }

  if (Platform.OS === "ios") {
    try {
      const { RTCAudioSession } = await import("react-native-webrtc");
      RTCAudioSession.audioSessionDidDeactivate();
    } catch {
      // Ignore teardown errors.
    }
  }

  active = false;
}
