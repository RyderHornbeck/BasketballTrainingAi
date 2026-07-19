export interface ConnectivitySnapshot {
  offline: boolean;
  networkKnown: boolean;
  failureRevision: number;
  dismissedRevision: number;
  source: string | null;
}

type Listener = () => void;

let snapshot: ConnectivitySnapshot = {
  offline: false,
  networkKnown: false,
  failureRevision: 0,
  dismissedRevision: 0,
  source: null,
};
let lastFailureAt = 0;
const listeners = new Set<Listener>();

function publish(next: ConnectivitySnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConnectivitySnapshot(): ConnectivitySnapshot {
  return snapshot;
}

export function updateNetworkConnectivity(offline: boolean): void {
  if (offline) {
    if (snapshot.networkKnown && snapshot.offline) return;
    publish({
      ...snapshot,
      offline: true,
      networkKnown: true,
      failureRevision: snapshot.failureRevision + 1,
      source: "device",
    });
    return;
  }

  if (snapshot.networkKnown && !snapshot.offline && snapshot.failureRevision === 0) return;
  publish({
    offline: false,
    networkKnown: true,
    failureRevision: 0,
    dismissedRevision: 0,
    source: null,
  });
}

export function reportNetworkFailure(source = "network"): void {
  const now = Date.now();
  // One failed action can fan out into several Supabase requests. Treat that
  // burst as one banner, while allowing a later action to show it again.
  if (now - lastFailureAt < 1_000 && snapshot.source === source) return;
  lastFailureAt = now;
  publish({
    ...snapshot,
    failureRevision: snapshot.failureRevision + 1,
    source,
  });
}

export function dismissConnectionBanner(): void {
  if (snapshot.failureRevision <= snapshot.dismissedRevision) return;
  publish({ ...snapshot, dismissedRevision: snapshot.failureRevision });
}

export function isLikelyNetworkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /network|fetch|offline|connection|timed out|timeout|internet/i.test(message);
}
