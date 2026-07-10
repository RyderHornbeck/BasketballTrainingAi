import {
  configureNotificationHandler,
  registerForPushNotificationsAsync,
  setupNotificationResponseHandler,
} from "@/lib/notifications";
import { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useAuth } from "./useAuth";

/**
 * Registers for push notifications once a user is signed in and has
 * completed onboarding. Also wires up tap-to-open for plan-ready alerts.
 * Silently no-ops if permission is denied or the device doesn't support
 * push (e.g. simulator/web) — the app still works.
 */
export function usePushNotifications() {
  const { user, profile } = useAuth();

  useEffect(() => {
    configureNotificationHandler();
    return setupNotificationResponseHandler();
  }, []);

  useEffect(() => {
    if (!user || !profile?.onboarding_completed) return;

    // Defer until after first paint so startup TurboModule calls don't race
    // native module initialization (especially with WebRTC linked).
    const task = InteractionManager.runAfterInteractions(() => {
      registerForPushNotificationsAsync(user.id);
    });

    return () => task.cancel();
  }, [user, profile?.onboarding_completed]);
}
