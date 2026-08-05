export interface TurnGuard {
  turnId: string;
  speechEpoch: number;
  stateVersion: number;
}

export function shouldAcceptTurnEvent(
  guard: TurnGuard,
  event: {
    turnId: string;
    speechEpoch: number;
    stateVersion?: number;
  }
): boolean {
  return (
    event.turnId === guard.turnId &&
    event.speechEpoch === guard.speechEpoch &&
    (event.stateVersion == null || event.stateVersion >= guard.stateVersion)
  );
}

export function shouldAcceptPlaybackChunk(
  current: {
    speechEpoch: number;
    playbackGeneration: number;
    contextId: string | null;
    active: boolean;
  },
  chunk: {
    speechEpoch: number;
    playbackGeneration: number;
    contextId: string;
  }
): boolean {
  return (
    current.active &&
    current.speechEpoch === chunk.speechEpoch &&
    current.playbackGeneration === chunk.playbackGeneration &&
    current.contextId === chunk.contextId
  );
}

