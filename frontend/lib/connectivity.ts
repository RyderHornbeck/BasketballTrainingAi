import NetInfo from "@react-native-community/netinfo";

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
let reachabilityCheckInFlight = false;
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
  // A request can fail while the device still has internet access (for
  // example a video provider, WebRTC peer, or server is temporarily down).
  // Confirm the device's actual reachability before showing an app-wide
  // "No connection" warning.
  if (reachabilityCheckInFlight) return;
  reachabilityCheckInFlight = true;
  void NetInfo.fetch()
    .then((state) => {
      const offline = state.isConnected === false || state.isInternetReachable === false;
      updateNetworkConnectivity(offline);
      if (!offline) return;

      showConfirmedNetworkFailure(source);
    })
    .catch(() => {
      // Preserve a banner for an actual reachability-check failure, while
      // still avoiding a false offline message for ordinary service errors.
      showConfirmedNetworkFailure(source);
    })
    .finally(() => {
      reachabilityCheckInFlight = false;
    });
}

function showConfirmedNetworkFailure(source: string): void {
  // Passive reachability changes never open the banner. Only a caller that
  // reports a failed user action reaches this function.
  if (snapshot.failureRevision > snapshot.dismissedRevision) return;

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
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "";
  return /network|fetch|offline|connection|timed out|timeout|internet/i.test(message);
}
