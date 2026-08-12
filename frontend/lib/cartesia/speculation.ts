export interface SpeculationIdentity {
  inkRequestId: string;
  transcript: string;
  speechEpoch: number;
  stateVersion: number;
  aborted: boolean;
}

export interface FinalTurnIdentity {
  inkRequestId: string;
  transcript: string;
  speechEpoch: number;
  stateVersion: number;
}

export function normalizeSpeculativeTranscript(transcript: string): string {
  return transcript.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isSafeSpeculativeTranscript(transcript: string): boolean {
  const normalized = normalizeSpeculativeTranscript(transcript);
  // Speculation is opt-in, not a mutation deny-list. Any workout request can
  // require tools even if it does not begin with an imperative verb.
  return /^(?:(?:hey|hi|hello|thanks|thank you|bye|goodbye)[!. ]*|(?:what(?:'s| is) your name|who are you)[?.! ]*|(?:motivate me|encourage me|give me (?:some )?(?:motivation|encouragement)|tell me (?:a )?(?:joke|fun fact)|how (?:do|can) i (?:improve|shoot|(?:improve )?(?:my )?dribbl(?:e|ing)|finish|defend)|(?:give me|share) (?:a )?(?:shooting|dribbling|finishing|defense) tip)[?.! ]*)$/i
    .test(normalized);
}

export function shouldPromoteSpeculation(
  speculation: SpeculationIdentity,
  finalTurn: FinalTurnIdentity
): boolean {
  return (
    !speculation.aborted &&
    speculation.inkRequestId === finalTurn.inkRequestId &&
    speculation.speechEpoch === finalTurn.speechEpoch &&
    speculation.stateVersion === finalTurn.stateVersion &&
    normalizeSpeculativeTranscript(speculation.transcript) ===
      normalizeSpeculativeTranscript(finalTurn.transcript)
  );
}

/** Ignore a final Ink transcript only when it is a substantial excerpt of Coach's own speech. */
export function isLikelyPlaybackEcho(
  transcript: string,
  coachSpeech: string | null | undefined,
): boolean {
  const echoNumbers: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
  };
  const normalizeEchoText = (value: string) => normalizeSpeculativeTranscript(value)
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
      (word) => echoNumbers[word] ?? word,
    )
    .replace(/[^a-z0-9' ]/g, "")
    .trim();
  const heard = normalizeEchoText(transcript);
  const spoken = normalizeEchoText(coachSpeech ?? "");
  const heardWords = heard.split(" ").filter(Boolean);
  if (!spoken || heardWords.length < 2) return false;
  // During active playout, even a short two-word excerpt such as "nice work"
  // is strong echo evidence when it is a contiguous slice of Coach's actual
  // speech. One-word transcripts remain eligible for real interruptions like
  // "stop" or "wait".
  if (spoken.includes(heard)) return true;
  if (heardWords.length >= 3 && heard.length >= 12 && heard.includes(spoken)) return true;

  // Far-field ASR can distort a speaker echo enough that it no longer remains
  // a contiguous substring (for example, "doing want art it" for "doing
  // great, do you want to start it"). Compare only meaningful terms so that
  // common conversational glue does not suppress a genuine user barge-in.
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "do", "for", "from",
    "i", "in", "is", "it", "of", "on", "or", "that", "the", "this",
    "to", "we", "with", "you", "your",
  ]);
  const meaningfulHeard = heardWords.filter((word) => !stopWords.has(word));
  const spokenWords = new Set(
    spoken.split(" ").filter((word) => word && !stopWords.has(word)),
  );
  const overlappingWords = meaningfulHeard.filter((word) => spokenWords.has(word));
  return (
    meaningfulHeard.length >= 3 &&
    overlappingWords.length >= 2 &&
    overlappingWords.length / meaningfulHeard.length >= 0.6
  );
}

export type PlaybackTranscriptClassification = "echo" | "user" | "ambiguous";

/**
 * Classify live ASR received while Coach is playing. Short partials wait for
 * more evidence; a substantial novel phrase can promote a natural barge-in
 * before the provider's final transcription arrives.
 */
export function classifyPlaybackTranscript(
  transcript: string,
  coachSpeech: string | null | undefined,
): PlaybackTranscriptClassification {
  if (isLikelyPlaybackEcho(transcript, coachSpeech)) return "echo";
  const words = normalizeSpeculativeTranscript(transcript)
    .replace(/[^a-z0-9' ]/g, "")
    .split(" ")
    .filter(Boolean);
  return words.length >= 3 ? "user" : "ambiguous";
}
