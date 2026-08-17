import {
  normalizeCoachSpeech,
  parseCoachSpeechIntent,
  type CoachSpeechIntent,
} from "./coachSpeech";
import { isLikelyPlaybackEcho } from "./cartesia/speculation";

type ShotSpeechIntent = Extract<CoachSpeechIntent, { kind: "shot" }>;

export function parseSafePlaybackShotIntent(
  transcript: string,
  coachSpeech: string | null | undefined,
): ShotSpeechIntent | null {
  const normalized = normalizeCoachSpeech(transcript);
  const direct = parseCoachSpeechIntent(normalized);
  if (
    direct?.kind === "shot" &&
    !isLikelyPlaybackEcho(normalized, coachSpeech)
  ) {
    return direct;
  }

  // Far-field ASR can merge the end of Coach's transition narration with the
  // athlete's command (for example, "start shooting miss"). Accept the
  // trailing shot only when the preceding words are demonstrably Coach echo.
  const words = normalized.split(" ").filter(Boolean);
  for (let index = 1; index < words.length; index += 1) {
    const prefix = words.slice(0, index).join(" ");
    const suffix = words.slice(index).join(" ");
    const suffixIntent = parseCoachSpeechIntent(suffix);
    if (
      suffixIntent?.kind === "shot" &&
      isLikelyPlaybackEcho(prefix, coachSpeech) &&
      !isLikelyPlaybackEcho(suffix, coachSpeech)
    ) {
      return suffixIntent;
    }
  }
  return null;
}
