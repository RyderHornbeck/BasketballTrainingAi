import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { useEffect } from "react";
import { useAuth } from "./useAuth";

/**
 * Registers for push notifications once a user is signed in and has
 * completed onboarding. Silently no-ops if permission is denied or the
 * device doesn't support push (e.g. simulator/web) -- the app still works.
 */
export function usePushNotifications() {
  const { user, profile } = useAuth();

  useEffect(() => {
    if (!user || !profile?.onboarding_completed) return;
    if (profile.push_token) return;
    registerForPushNotificationsAsync(user.id);
  }, [user, profile]);
}
