import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ThemeMode } from "@/components/ThemeProvider";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { clearOnboardingDraft } from "@/lib/onboardingDraft";
import { supabase } from "@/lib/supabase";
import {
  defaultWorkoutReminder,
  disableWorkoutReminder,
  enableWorkoutReminder,
  loadWorkoutReminder,
  requestWorkoutReminderPermission,
  WorkoutReminder,
} from "@/lib/workoutReminders";
import { OnboardingAnswers } from "@/types/database";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const PRIVACY_POLICY_URL = "https://www.courtcoachai.org/privacy-policy";
const TERMS_OF_SERVICE_URL = "https://www.courtcoachai.org/terms-of-service";

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const { user, profile, signOut } = useAuth();
  const [athleteDetails, setAthleteDetails] = useState<Pick<
    OnboardingAnswers,
    "overall_skill_level" | "position"
  > | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [reminder, setReminder] = useState<WorkoutReminder>(defaultWorkoutReminder);
  const [reminderLoading, setReminderLoading] = useState(true);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);

  const reminderTime = useMemo(
    () => new Date(2000, 0, 1, reminder.hour, reminder.minute),
    [reminder.hour, reminder.minute]
  );

  useEffect(() => {
    if (!user) return;

    let mounted = true;
    void Promise.all([
      supabase
        .from("onboarding_answers")
        .select("overall_skill_level, position")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadWorkoutReminder(user.id),
    ]).then(([detailsResult, storedReminder]) => {
      if (!mounted) return;
      if (detailsResult.error) {
        console.error("Failed to load athlete details:", detailsResult.error.message);
      }
      setAthleteDetails(
        (detailsResult.data as Pick<OnboardingAnswers, "overall_skill_level" | "position"> | null) ??
          null
      );
      setDetailsLoading(false);
      setReminder(storedReminder);
      setReminderEnabled(storedReminder.enabled);
      setReminderLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  const handleSignOut = () => {
    Alert.alert("Sign out?", "You can sign back in anytime to continue your training.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/auth/login");
        },
      },
    ]);
  };

  const handleReminderToggle = async (nextEnabled: boolean) => {
    if (!user || reminderSaving) return;

    if (!nextEnabled) {
      setReminderSaving(true);
      try {
        const disabledReminder = await disableWorkoutReminder(user.id);
        setReminder(disabledReminder);
        setReminderEnabled(false);
      } catch {
        Alert.alert("Could not turn off reminders", "Please try again.");
      } finally {
        setReminderSaving(false);
      }
      return;
    }

    setReminderSaving(true);
    try {
      const granted = await requestWorkoutReminderPermission();
      if (!granted) {
        Alert.alert(
          "Notifications are off",
          "Go to your phone's Settings and turn on notifications for Court Coach AI, then try again."
        );
        return;
      }
      setReminderEnabled(true);
    } catch {
      Alert.alert("Could not enable reminders", "Please try again.");
    } finally {
      setReminderSaving(false);
    }
  };

  const handleReminderTimeChange = (_: unknown, selectedDate?: Date) => {
    if (!selectedDate) return;
    setReminder((current) => ({
      ...current,
      hour: selectedDate.getHours(),
      minute: selectedDate.getMinutes(),
    }));
  };

  const handleSaveReminder = async () => {
    if (!user || reminderSaving) return;
    setReminderSaving(true);
    try {
      const savedReminder = await enableWorkoutReminder(user.id, reminder);
      if (!savedReminder) {
        setReminderEnabled(false);
        Alert.alert(
          "Notifications are off",
          "Go to your phone's Settings and turn on notifications for Court Coach AI, then try again."
        );
        return;
      }
      setReminder(savedReminder);
      setReminderEnabled(true);
      Alert.alert("Reminder set", `Court Coach will remind you every day at ${formatReminderTime(savedReminder)}.`);
    } catch {
      Alert.alert("Could not save reminder", "Please try again.");
    } finally {
      setReminderSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Permanently delete account?",
      "This permanently deletes your account, sign-in, workouts, analytics, badges, coach history, and onboarding data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const { data, error } = await supabase.functions.invoke<{ error?: string }>(
                "delete-account",
                { body: { confirmation: "DELETE" } }
              );
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await clearOnboardingDraft();
              await supabase.auth.signOut({ scope: "local" });
              router.replace("/auth/login");
            } catch (err) {
              Alert.alert(
                "Delete failed",
                err instanceof Error ? err.message : "Could not delete your account. Please try again."
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.header, { color: colors.text }]}>Profile</Text>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Athlete</Text>
        <Card style={styles.card}>
          {detailsLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <ProfileRow
                label="Skill Level"
                value={capitalize(athleteDetails?.overall_skill_level) ?? "--"}
              />
              <Divider />
              <ProfileRow label="Position" value={athleteDetails?.position ?? "--"} />
              <Divider />
              <ProfileRow
                label="Joined Court Coach"
                value={formatJoinedDate(profile?.created_at)}
              />
            </>
          )}
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Workout Reminders</Text>
        <Card style={styles.card}>
          {reminderLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <View style={styles.reminderToggleRow}>
                <View style={styles.reminderCopy}>
                  <Text style={[styles.reminderTitle, { color: colors.text }]}>Daily workout reminder</Text>
                  <Text style={[styles.reminderSubtitle, { color: colors.textSecondary }]}>
                    {reminderEnabled
                      ? `Every day at ${formatReminderTime(reminder)}`
                      : "Choose a time to get a local reminder"}
                  </Text>
                </View>
                <Switch
                  value={reminderEnabled}
                  onValueChange={(value) => void handleReminderToggle(value)}
                  disabled={reminderSaving}
                  trackColor={{ false: colors.cardAlt, true: colors.accentMuted }}
                  thumbColor={reminderEnabled ? colors.accent : colors.textMuted}
                />
              </View>

              {reminderEnabled ? (
                <>
                  <View style={[styles.reminderDivider, { backgroundColor: colors.border }]} />
                  <Text style={[styles.timeLabel, { color: colors.text }]}>Reminder time</Text>
                  <DateTimePicker
                    value={reminderTime}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleReminderTimeChange}
                    themeVariant={mode}
                    style={styles.timePicker}
                  />
                  <Button
                    title="Save Daily Reminder"
                    variant="secondary"
                    onPress={() => void handleSaveReminder()}
                    loading={reminderSaving}
                    style={styles.saveReminderButton}
                  />
                </>
              ) : null}
            </>
          )}
        </Card>

        <Button
          title="How to use Court Coach AI"
          variant="secondary"
          onPress={() => router.push("/coach-guide")}
          style={styles.actionButton}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
        <Card style={styles.card}>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setMode(opt.value);
                    if (user) {
                      supabase
                        .from("profiles")
                        .update({ theme: opt.value })
                        .eq("id", user.id)
                        .then(({ error }) => {
                          if (error) console.error("Failed to save theme preference:", error.message);
                        });
                    }
                  }}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: active ? colors.accent : colors.cardAlt,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: active ? "#FFFFFF" : colors.text, fontWeight: "700" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>
        <Button
          title="Delete Account"
          variant="danger"
          onPress={handleDeleteAccount}
          loading={deleting}
          style={styles.actionButton}
        />
        <Button
          title="Sign Out"
          variant="danger"
          onPress={handleSignOut}
          style={styles.actionButton}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Information</Text>
        <Button
          title="Privacy Policy"
          variant="outline"
          onPress={() => {
            void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
              Alert.alert("Unable to open link", "Please visit courtcoachai.org/privacy-policy.");
            });
          }}
          style={styles.actionButton}
        />
        <Button
          title="Terms of Service"
          variant="outline"
          onPress={() => {
            void Linking.openURL(TERMS_OF_SERVICE_URL).catch(() => {
              Alert.alert("Unable to open link", "Please visit courtcoachai.org/terms-of-service.");
            });
          }}
          style={styles.actionButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

function capitalize(value?: string | null): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatJoinedDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function formatReminderTime(reminder: Pick<WorkoutReminder, "hour" | "minute">): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, reminder.hour, reminder.minute));
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  header: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 20,
  },
  card: {
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
    maxWidth: "60%",
    textAlign: "right",
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
    marginTop: 4,
  },
  themeRow: {
    flexDirection: "row",
    gap: 10,
  },
  themeOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionButton: {
    marginBottom: 12,
  },
  reminderToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  reminderCopy: {
    flex: 1,
  },
  reminderTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  reminderSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  reminderDivider: {
    height: 1,
    marginVertical: 16,
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  timePicker: {
    alignSelf: "stretch",
  },
  saveReminderButton: {
    marginTop: 8,
  },
});
