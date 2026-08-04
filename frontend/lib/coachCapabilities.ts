import {
  COACH_CAPABILITY_ORDER,
  type CoachCapability,
} from "./generated/coachTools";

/**
 * Selects candidate tool groups only. This never executes a command; uncertain
 * language deliberately receives every capability.
 */
export function inferCoachCapabilities(transcript: string): CoachCapability[] {
  const text = transcript.toLowerCase();
  const capabilities = new Set<CoachCapability>(["reads"]);
  if (/\b(?:make|made|miss|missed|brick|airball|swish|shot|shooting|attempt|target|percentage)\b/.test(text)) {
    capabilities.add("shots");
  }
  if (/\b(?:timer|second|minute|pause|resume|countdown)\b/.test(text)) {
    capabilities.add("timers");
  }
  if (/\b(?:next|previous|first|last|where|move|switch|skip|drill|exercise|set)\b/.test(text)) {
    capabilities.add("navigation");
  }
  if (/\b(?:complete|finished|done|reopen|uncomplete|finish workout)\b/.test(text)) {
    capabilities.add("completion");
  }
  if (/\b(?:add|remove|change|extend|shorten|longer|shorter)\b/.test(text)) {
    capabilities.add("edits");
  }
  if (/\b(?:recommend|suggest|weakness|work on|catalog|find)\b/.test(text)) {
    capabilities.add("recommendations");
  }
  if (/\b(?:note|remember)\b/.test(text)) capabilities.add("notes");
  if (capabilities.size === 1 && !/\b(?:progress|workout|how|what|where|list)\b/.test(text)) {
    return [...COACH_CAPABILITY_ORDER];
  }
  return COACH_CAPABILITY_ORDER.filter((capability) => capabilities.has(capability));
}
