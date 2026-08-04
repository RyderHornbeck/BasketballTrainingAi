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

