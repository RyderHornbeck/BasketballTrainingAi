import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { configureNotificationHandler } from "./notifications";

export interface WorkoutReminder {
  enabled: boolean;
  hour: number;
  minute: number;
  notificationId: string | null;
}

const REMINDER_KEY_PREFIX = "court-coach:workout-reminder:";

function storageKey(userId: string): string {
  return `${REMINDER_KEY_PREFIX}${userId}`;
}

function isValidReminder(value: unknown): value is WorkoutReminder {
  if (!value || typeof value !== "object") return false;
  const reminder = value as Partial<WorkoutReminder>;
  const { hour, minute } = reminder;
  return (
    typeof reminder.enabled === "boolean" &&
    typeof hour === "number" &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    typeof minute === "number" &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59 &&
    (typeof reminder.notificationId === "string" || reminder.notificationId === null)
  );
}

export function defaultWorkoutReminder(): WorkoutReminder {
  return { enabled: false, hour: 17, minute: 0, notificationId: null };
}

export async function loadWorkoutReminder(userId: string): Promise<WorkoutReminder> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return defaultWorkoutReminder();

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidReminder(parsed) ? parsed : defaultWorkoutReminder();
  } catch {
    return defaultWorkoutReminder();
  }
}

export async function requestWorkoutReminderPermission(): Promise<boolean> {
  configureNotificationHandler();
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function configureAndroidReminderChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("workout-reminders", {
    name: "Workout reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF7A1A",
  });
}

async function persistWorkoutReminder(userId: string, reminder: WorkoutReminder): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(reminder));
}

/**
 * Replaces the current reminder with one daily local notification.
 * It intentionally asks permission only when the user turns reminders on.
 */
export async function enableWorkoutReminder(
  userId: string,
  time: Pick<WorkoutReminder, "hour" | "minute">
): Promise<WorkoutReminder | null> {
  const permitted = await requestWorkoutReminderPermission();
  if (!permitted) return null;

  await configureAndroidReminderChannel();
  const current = await loadWorkoutReminder(userId);
  if (current.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(current.notificationId);
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: "Time to train",
      body: "Your Court Coach workout is ready when you are.",
      sound: "default",
      data: { type: "workout_reminder" },
      ...(Platform.OS === "android" ? { channelId: "workout-reminders" } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
    },
  });

  const reminder: WorkoutReminder = {
    enabled: true,
    hour: time.hour,
    minute: time.minute,
    notificationId,
  };
  await persistWorkoutReminder(userId, reminder);
  return reminder;
}

export async function disableWorkoutReminder(userId: string): Promise<WorkoutReminder> {
  const current = await loadWorkoutReminder(userId);
  if (current.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(current.notificationId);
  }

  const reminder = { ...current, enabled: false, notificationId: null };
  await persistWorkoutReminder(userId, reminder);
  return reminder;
}
