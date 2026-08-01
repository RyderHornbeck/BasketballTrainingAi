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
