export type ShotInputMode = "voice" | "video";
export type ShotEventSource = "voice" | "video";
export type ShotResult = "make" | "miss";

export type ShotEventGate =
  | { status: "accepted" }
  | { status: "ignored"; reason: "voice_disabled" | "video_disabled" }
  | { status: "duplicate"; reason: "duplicate_event" };

export function gateShotEvent(
  mode: ShotInputMode,
  source: ShotEventSource,
  eventId: string,
  seenVideoEventIds: Set<string>,
): ShotEventGate {
  if (source === "voice" && mode === "video") {
    return { status: "ignored", reason: "voice_disabled" };
  }
  if (source === "video" && mode !== "video") {
    return { status: "ignored", reason: "video_disabled" };
  }
  if (source === "video") {
    if (seenVideoEventIds.has(eventId)) {
      return { status: "duplicate", reason: "duplicate_event" };
    }
    seenVideoEventIds.add(eventId);
  }
  return { status: "accepted" };
}
