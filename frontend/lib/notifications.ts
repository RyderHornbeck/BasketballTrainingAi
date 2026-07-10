import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";
import { supabase } from "./supabase";

let handlerConfigured = false;

/** Configure foreground notification presentation. Safe to call multiple times. */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  } catch (err) {
    console.error("Failed to configure notification handler:", err);
  }
}

/**
 * Requests notification permission (if not already granted/denied), fetches
 * the Expo push token, and saves it to `profiles.push_token`. Safe to call
 * multiple times; failures are swallowed so the app keeps working normally
 * when push permission is denied or unavailable (e.g. on a simulator).
 */
export async function registerForPushNotificationsAsync(
  userId: string
): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log("Push notifications require a physical device; skipping.");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF7A1A",
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Push notification permission denied.");
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;

    const { error } = await supabase
      .from("profiles")
      .update({ push_token: token })
      .eq("id", userId);

    if (error) {
      console.error("Failed to save push token:", error.message);
    }

    return token;
  } catch (err) {
    console.error("registerForPushNotificationsAsync error:", err);
    return null;
  }
}

/** Open the workout days tab when the user taps a plan-ready notification. */
export function setupNotificationResponseHandler(): () => void {
  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { plan_id?: string } | undefined;
      if (data?.plan_id) {
        router.push("/(tabs)/days");
      }
    });
    return () => subscription.remove();
  } catch (err) {
    console.error("Failed to set up notification response handler:", err);
    return () => {};
  }
}
