import { parseCoachSpeechIntent } from "./coachSpeech";

export interface ParsedShotCount {
  made: boolean;
  count: number;
}

export interface ShotSpeechCommand {
  mode: "increment" | "replace";
  makes: number;
  attempts: number;
  source: "count" | "ratio";
}

export function mergeShotProgress(
  base: { makes: number; attempts: number },
  update: { makes: number; attempts: number; mode: "increment" | "replace" }
): { makes: number; attempts: number } {
  const makes = update.mode === "increment" ? base.makes + update.makes : update.makes;
  const attempts =
    update.mode === "increment" ? base.attempts + update.attempts : update.attempts;
  return { makes, attempts: Math.max(makes, attempts) };
}

export function capShotProgressToTarget(
  progress: { makes: number; attempts: number },
  targetAttempts: number | null | undefined,
): { makes: number; attempts: number } {
  const attempts =
    targetAttempts != null && targetAttempts > 0
      ? Math.min(progress.attempts, targetAttempts)
      : progress.attempts;
  return { makes: Math.min(progress.makes, attempts), attempts };
}

export function parseShotSpeechCommand(transcript: string | null): ShotSpeechCommand | null {
  const parsed = parseCoachSpeechIntent(transcript);
  return parsed?.kind === "shot" ? parsed.args : null;
}

export function parseSpokenShotCount(transcript: string | null): ParsedShotCount | null {
  const command = parseShotSpeechCommand(transcript);
  if (!command || command.mode !== "increment" || command.attempts < 1) return null;
  if (command.makes === command.attempts) return { made: true, count: command.attempts };
  if (command.makes === 0) return { made: false, count: command.attempts };
  return null;
}
