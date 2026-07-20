import * as Haptics from "expo-haptics";

function ignoreUnavailable(request: Promise<void>): void {
  void request.catch(() => {
    // Older native builds may not include ExpoHaptics yet. Haptics are
    // enhancement-only, so interaction must still succeed without them.
  });
}

export function selectionHaptic(): void {
  ignoreUnavailable(Haptics.selectionAsync());
}

export function actionHaptic(): void {
  ignoreUnavailable(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function completionHaptic(): void {
  ignoreUnavailable(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}
