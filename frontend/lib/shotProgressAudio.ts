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

const assetUriPromises = new Map<number, Promise<string>>();

function resolveAssetUri(moduleId: number): Promise<string> {
  const cached = assetUriPromises.get(moduleId);
  if (cached) return cached;
  const pending = Asset.fromModule(moduleId)
    .downloadAsync()
    .then((asset) => asset.localUri ?? asset.uri)
    .catch((error) => {
      assetUriPromises.delete(moduleId);
      throw error;
    });
  assetUriPromises.set(moduleId, pending);
  return pending;
}

/**
 * A single make or miss is by far the next most likely command. Warm both
 * possible score prefixes while the current local reply plays. Multi-shot
 * commands still use their normal dynamic path; this cache never selects or
 * forces a response.
 */
export function preloadLikelyNextShotProgressAudio(
  persona: string,
  reply: ShotProgressReply,
): void {
  if (!(persona in SHOT_PROGRESS_AUDIO) || reply.shotsLeft < 1) return;
  const clips = SHOT_PROGRESS_AUDIO[persona as ShotProgressPersona];
  const nextAttempts = reply.attempts + 1;
  const nextRemaining = reply.shotsLeft - 1;
  const nextPrefixIds = [
    clips.prefixes[`${reply.makes}-${nextAttempts}`],
    clips.prefixes[`${reply.makes + 1}-${nextAttempts}`],
  ].filter((id): id is number => id != null);
  const remainingId = clips.remaining[nextRemaining];
  void Promise.all([
    ...nextPrefixIds.map(resolveAssetUri),
    ...(remainingId != null ? [resolveAssetUri(remainingId)] : []),
  ]).catch(() => undefined);
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
): (() => Promise<void>) | null {
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
  void Promise.all([resolveAssetUri(prefix), resolveAssetUri(remaining)])
    .then(async (uris) => {
      if (stopped) return;
      playbackId = await playLocalFilesAsync(uris);
      if (stopped) await clearPlaybackAsync();
    })
    .catch(() => finish());

  return async () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    await clearPlaybackAsync().catch(() => undefined);
  };
}
