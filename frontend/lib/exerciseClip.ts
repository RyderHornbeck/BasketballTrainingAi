import { ExerciseVideoClip } from "@/types/database";

export const CATALOG_ONLY_VIDEO_ID = "hoopplan-catalog";

export function isCatalogOnlyClip(clip: ExerciseVideoClip | null | undefined): boolean {
  return clip?.youtube_video_id === CATALOG_ONLY_VIDEO_ID;
}

export function hasVideoDemo(clip: ExerciseVideoClip | null | undefined): boolean {
  if (!clip?.youtube_video_id) return false;
  return !isCatalogOnlyClip(clip);
}
