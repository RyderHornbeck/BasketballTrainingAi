import { Asset } from "expo-asset";
import {
  addLocalPlaybackFinishedListener,
  clearPlaybackAsync,
  playLocalFilesAsync,
} from "expo-duplex-audio";

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

  let stopped = false;
  let playbackId: string | null = null;
  let subscription: { remove: () => void } | null = null;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    onFinished();
  };

  // The native duplex module is the only owner of the active voice-call
  // session. It decodes these packaged files into its existing voice-chat
  // output graph, preserving speaker volume and hardware echo cancellation.
  subscription = addLocalPlaybackFinishedListener((event) => {
    if (event.playbackId === playbackId) finish();
  });
  void Promise.all([Asset.fromModule(prefix).downloadAsync(), Asset.fromModule(remaining).downloadAsync()])
    .then(async (assets) => {
      if (stopped) return;
      const uris = assets.map((asset) => asset.localUri ?? asset.uri);
      playbackId = await playLocalFilesAsync(uris);
      if (stopped) await clearPlaybackAsync();
    })
    .catch(() => finish());

  return () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    void clearPlaybackAsync().catch(() => undefined);
  };
}
