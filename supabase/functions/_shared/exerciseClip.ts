export const CATALOG_ONLY_VIDEO_ID = "hoopplan-catalog";

export function isCatalogOnlyVideoId(videoId: string | null | undefined): boolean {
  return videoId === CATALOG_ONLY_VIDEO_ID;
}

export function hasVideoDemoFromClip(clip: {
  youtube_video_id: string | null;
} | null | undefined): boolean {
  if (!clip?.youtube_video_id) return false;
  return !isCatalogOnlyVideoId(clip.youtube_video_id);
}
