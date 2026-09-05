const WORKOUT_STRUCTURE_CHANGE_REPLY =
  "Coach cannot add or remove drills. It can only add sets to drills already in your workout. If you would like to add or remove something, you can manually edit your workout in the main app.";

function normalizeRemovalSpeech(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removal is intentionally local and read-only. Coach must never convert a
 * request to remove a drill/set into a timer action or a backend mutation.
 */
export function isLocalWorkoutStructureChangeRequest(transcript: string): boolean {
  const text = normalizeRemovalSpeech(transcript);
  if (!text) return false;

  if (
    /\b(?:can|could|would|will) you(?: please)? remove (?:this|that|it)\b/.test(
      text,
    )
  ) {
    return true;
  }

  const item = "(?:drill|exercise|set)";
  const reference = "(?:(?:this|that|the|my|current|a|an)\\s+)?";
  return (
    new RegExp(
      `\\b(?:remove|delete)\\b(?:\\s+\\w+){0,8}\\s+${reference}${item}\\b`,
    ).test(text) ||
    new RegExp(
      `\\b(?:take|cut)\\s+${reference}${item}\\s+(?:out|off)\\b`,
    ).test(text) ||
    new RegExp(`\\bget rid of\\s+${reference}${item}\\b`).test(text) ||
    new RegExp(
      `\\b${reference}${item}\\b(?:\\s+\\w+){0,8}\\s+\\b(?:remove|delete|take out|get rid of)\\b`,
    ).test(text) ||
    new RegExp(
      `\\b(?:add|include|insert|put\\s+in)\\b(?:\\s+\\w+){0,8}\\s+(?:a\\s+)?${item}\\b`,
    ).test(text) ||
    /\b(?:can|could|would|will) you(?: please)? add\b/.test(text)
  );
}

export const LOCAL_WORKOUT_STRUCTURE_CHANGE_REPLY = WORKOUT_STRUCTURE_CHANGE_REPLY;
