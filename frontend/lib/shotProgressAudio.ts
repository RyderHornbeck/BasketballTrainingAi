import { createAudioPlaylist, setAudioModeAsync } from "expo-audio";

import {
  SHOT_PROGRESS_AUDIO,
  type ShotProgressPersona,
} from "@/assets/sounds/ShotProgress/manifest";

export interface ShotProgressReply {
  makes: number;
  attempts: number;
  shotsLeft: number;
}

export function parseShotProgressReply(text: string): ShotProgressReply | null {
  const match = text.trim().match(
    /^You're\s+(\d+)\s+for\s+(\d+),\s+(\d+)\s+shots?\s+left\.?$/i,
  );
  if (!match) return null;
  const makes = Number(match[1]);
  const attempts = Number(match[2]);
  const shotsLeft = Number(match[3]);
  if (
    !Number.isInteger(makes) ||
    !Number.isInteger(attempts) ||
    !Number.isInteger(shotsLeft) ||
    makes < 0 ||
    attempts < makes ||
    attempts > 20 ||
    shotsLeft < 0 ||
    shotsLeft > 20
  ) {
    return null;
  }
  return { makes, attempts, shotsLeft };
}

export function playShotProgressAudio(
  persona: string,
  reply: ShotProgressReply,
  onFinished: () => void,
): (() => void) | null {
  if (!(persona in SHOT_PROGRESS_AUDIO)) return null;
  const clips = SHOT_PROGRESS_AUDIO[persona as ShotProgressPersona];
  const prefix = clips.prefixes[`${reply.makes}-${reply.attempts}`];
  const remaining = clips.remaining[reply.shotsLeft];
  if (!prefix || !remaining) return null;

  // A single playlist hands off directly from prefix to remaining; there is no
  // JavaScript timer or separate-player scheduling gap between the clips.
  const playlist = createAudioPlaylist({ sources: [prefix, remaining], loop: "none" });
  let stopped = false;
  let subscription: { remove: () => void } | null = null;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    onFinished();
  };

  void setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);
  subscription = playlist.addListener("playlistStatusUpdate", (status) => {
    if (status.didJustFinish && status.currentIndex === status.trackCount - 1) finish();
  });
  playlist.play();

  return () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    try {
      playlist.pause();
    } catch {
      // The playlist may already be released during app teardown.
    }
  };
}
