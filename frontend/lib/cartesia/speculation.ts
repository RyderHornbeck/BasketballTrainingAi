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
