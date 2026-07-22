export const COACH_PROFILES = [
  {
    id: "tyler",
    name: "Coach Tyler",
    description: "Calm and focused.",
    voice: "ash",
  },
  {
    id: "devin",
    name: "Coach Devin",
    description: "Confident and energetic.",
    voice: "cedar",
  },
  {
    id: "maya",
    name: "Coach Maya",
    description: "Upbeat and encouraging.",
    voice: "marin",
  },
  {
    id: "ava",
    name: "Coach Ava",
    description: "Patient and supportive.",
    voice: "shimmer",
  },
] as const;

export type CoachVoice = (typeof COACH_PROFILES)[number]["voice"];

export const DEFAULT_COACH_VOICE: CoachVoice = "ash";

export function getCoachProfile(voice: string | null | undefined) {
  return COACH_PROFILES.find((coach) => coach.voice === voice) ?? COACH_PROFILES[0];
}
