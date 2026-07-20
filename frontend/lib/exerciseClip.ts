import { ExerciseVideoClip } from "@/types/database";

export const CATALOG_ONLY_VIDEO_ID = "hoopplan-catalog";

export function isCatalogOnlyClip(clip: ExerciseVideoClip | null | undefined): boolean {
  return clip?.youtube_video_id === CATALOG_ONLY_VIDEO_ID;
}

export function hasVideoDemo(clip: ExerciseVideoClip | null | undefined): boolean {
  // Video embeds are temporarily disabled while the drill catalog's YouTube
  // sources are reviewed. Keep the helper so callers consistently hide video
  // UI without needing per-screen feature flags.
  void clip;
  return false;
}
