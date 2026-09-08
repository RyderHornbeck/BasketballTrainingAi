import { Asset } from "expo-asset";
import {
  addLocalPlaybackFinishedListener,
  clearPlaybackAsync,
  playLocalFilesAsync,
} from "expo-duplex-audio";
import {
  VIDEO_SHOT_FEEDBACK_AUDIO,
  type VideoFeedbackPersona,
} from "@/assets/sounds/VideoShotFeedback/manifest";

const uriPromises = new Map<number, Promise<string>>();

function assetUri(moduleId: number): Promise<string> {
  const cached = uriPromises.get(moduleId);
  if (cached) return cached;
  const promise = Asset.fromModule(moduleId).downloadAsync().then((asset) => asset.localUri ?? asset.uri);
  uriPromises.set(moduleId, promise);
  return promise;
}

export function playVideoShotFeedbackAudio(
  persona: string,
  text: string,
  onFinished: () => void,
): (() => Promise<void>) | null {
  if (!(persona in VIDEO_SHOT_FEEDBACK_AUDIO)) return null;
  const moduleId = VIDEO_SHOT_FEEDBACK_AUDIO[persona as VideoFeedbackPersona][text];
  if (!moduleId) return null;
  let stopped = false;
  let playbackId: string | null = null;
  let subscription: { remove: () => void } | null = null;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    onFinished();
  };
  subscription = addLocalPlaybackFinishedListener((event) => {
    if (event.playbackId === playbackId) finish();
  });
  void assetUri(moduleId)
    .then(async (uri) => {
      if (stopped) return;
      playbackId = await playLocalFilesAsync([uri]);
      if (stopped) await clearPlaybackAsync();
    })
    .catch(finish);
  return async () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    await clearPlaybackAsync().catch(() => undefined);
  };
}

export function preloadVideoShotFeedbackAudio(persona: string, text: string): void {
  if (!(persona in VIDEO_SHOT_FEEDBACK_AUDIO)) return;
  const moduleId = VIDEO_SHOT_FEEDBACK_AUDIO[persona as VideoFeedbackPersona][text];
  if (moduleId) void assetUri(moduleId).catch(() => undefined);
}
