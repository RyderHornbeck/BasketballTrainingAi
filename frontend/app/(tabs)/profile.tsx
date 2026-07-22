import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Skeleton } from "@/components/Skeleton";
import { ThemeMode } from "@/components/ThemeProvider";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { reportNetworkFailure } from "@/lib/connectivity";
import { actionHaptic } from "@/lib/haptics";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal";
import { clearOnboardingDraft } from "@/lib/onboardingDraft";
import { logOutRevenueCatUser } from "@/lib/revenueCat";
import {
  COACH_PROFILES,
  DEFAULT_COACH_VOICE,
  CoachVoice,
} from "@/lib/coachProfiles";
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
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const SKILL_LEVEL_OPTIONS = ["beginner", "intermediate", "advanced", "elite"] as const;
const POSITION_OPTIONS = ["Guard", "Wing", "Big", "Unknown"] as const;
const WORKOUT_MINUTE_OPTIONS = [15, 30, 45, 60, 75, 90] as const;

type AthleteDetails = Pick<
  OnboardingAnswers,
  "overall_skill_level" | "position" | "minutes_per_workout"
>;
type EditableAthleteField = keyof AthleteDetails;

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const { user, profile, signOut } = useAuth();
  const [athleteDetails, setAthleteDetails] = useState<AthleteDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [athleteSaving, setAthleteSaving] = useState<EditableAthleteField | null>(null);
  const [showTrainingUpdateNotice, setShowTrainingUpdateNotice] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reminder, setReminder] = useState<WorkoutReminder>(defaultWorkoutReminder);
  const [reminderLoading, setReminderLoading] = useState(true);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [coachPickerOpen, setCoachPickerOpen] = useState(false);
  const [coachVoice, setCoachVoice] = useState<CoachVoice>(DEFAULT_COACH_VOICE);
  const [coachSaving, setCoachSaving] = useState(false);

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
        .select("overall_skill_level, position, minutes_per_workout")
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
        (detailsResult.data as AthleteDetails | null) ?? null
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

  useFocusEffect(
    useCallback(
      () => () => {
        // The confirmation belongs only to the visit in which a preference
        // changed; returning to Profile starts clean.
        setShowTrainingUpdateNotice(false);
      },
      []
    )
  );

  useEffect(() => {
    const voice = profile?.realtime_coach_voice;
    if (voice) setCoachVoice(voice);
  }, [profile?.realtime_coach_voice]);

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
      const savedReminder = await enableWorkoutReminder(user.id, reminder);
      if (!savedReminder) {
        Alert.alert(
          "Notifications are off",
          "Go to your phone's Settings and turn on notifications for Court Coach AI, then try again."
        );
        return;
      }
      setReminder(savedReminder);
      setReminderEnabled(true);
    } catch {
      Alert.alert("Could not enable reminders", "Please try again.");
    } finally {
      setReminderSaving(false);
    }
  };

  const handleReminderTimeChange = async (_: unknown, selectedDate?: Date) => {
    if (!selectedDate) return;
    const nextReminder = {
      ...reminder,
      hour: selectedDate.getHours(),
      minute: selectedDate.getMinutes(),
    };
    setReminder(nextReminder);
    if (!user || !reminderEnabled) return;
    setReminderSaving(true);
    try {
      const savedReminder = await enableWorkoutReminder(user.id, nextReminder);
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
    } catch {
      Alert.alert("Could not update reminder", "Please try again.");
    } finally {
      setReminderSaving(false);
    }
  };

  const handleCoachSelection = async (nextVoice: CoachVoice) => {
    if (!user || coachSaving || nextVoice === coachVoice) return;
    actionHaptic();
    const previousVoice = coachVoice;
    setCoachVoice(nextVoice);
    setCoachSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ realtime_coach_voice: nextVoice })
      .eq("id", user.id);
    if (error) {
      setCoachVoice(previousVoice);
      Alert.alert("Could not change coach", "Please try again.");
    }
    setCoachSaving(false);
  };

  const handleAthleteDetailChange = async (
    field: EditableAthleteField,
    value: string | number
  ) => {
    if (!user || !athleteDetails || athleteSaving) return;
    if (athleteDetails[field] === value) return;

    actionHaptic();
    const previousDetails = athleteDetails;
    setAthleteDetails({ ...athleteDetails, [field]: value } as AthleteDetails);
    setAthleteSaving(field);

    const { error } = await supabase
      .from("onboarding_answers")
      .update({ [field]: value })
      .eq("user_id", user.id);

    if (error) {
      setAthleteDetails(previousDetails);
      reportNetworkFailure("athlete-preferences");
      Alert.alert("Could not update athlete settings", "Please check your connection and try again.");
    } else {
      setShowTrainingUpdateNotice(true);
    }
    setAthleteSaving(null);
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
              await Promise.allSettled([
                supabase.auth.signOut({ scope: "local" }),
                logOutRevenueCatUser(),
              ]);
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
            <ProfileRowsSkeleton rows={4} />
          ) : (
            <>
              <AthletePreferencePicker
                label="Skill Level"
                options={SKILL_LEVEL_OPTIONS.map((value) => ({
                  label: capitalize(value) ?? value,
                  value,
                }))}
                selected={athleteDetails?.overall_skill_level ?? null}
                disabled={athleteSaving !== null}
                onSelect={(value) =>
                  void handleAthleteDetailChange("overall_skill_level", value)
                }
              />
              <Divider />
              <AthletePreferencePicker
                label="Position"
                options={POSITION_OPTIONS.map((value) => ({ label: value, value }))}
                selected={athleteDetails?.position ?? null}
                disabled={athleteSaving !== null}
                onSelect={(value) => void handleAthleteDetailChange("position", value)}
              />
              <Divider />
              <AthletePreferencePicker
                label="Time per workout"
                options={WORKOUT_MINUTE_OPTIONS.map((value) => ({
                  label: `${value} min`,
                  value: String(value),
                }))}
                selected={
                  athleteDetails?.minutes_per_workout != null
                    ? String(athleteDetails.minutes_per_workout)
                    : null
                }
                disabled={athleteSaving !== null}
                onSelect={(value) =>
                  void handleAthleteDetailChange("minutes_per_workout", Number(value))
                }
              />
              <Divider />
              <ProfileRow
                label="Joined Court Coach"
                value={formatJoinedDate(profile?.created_at)}
              />
              {showTrainingUpdateNotice ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.trainingUpdateNotice, { backgroundColor: colors.accentMuted }]}
                >
                  <Text style={[styles.trainingUpdateNoticeText, { color: colors.accent }]}>
                    In the next 5-workout block, you will see these changes.
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Workout Reminders</Text>
        <Card style={styles.card}>
          {reminderLoading ? (
            <View style={styles.reminderSkeletonRow}>
              <View style={styles.reminderSkeletonCopy}>
                <Skeleton width={175} height={17} borderRadius={7} />
                <Skeleton width={230} height={14} borderRadius={7} />
              </View>
              <Skeleton width={50} height={30} borderRadius={15} />
            </View>
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
                    onChange={(event, selectedDate) => void handleReminderTimeChange(event, selectedDate)}
                    themeVariant={mode}
                    style={styles.timePicker}
                  />
                </>
              ) : null}
            </>
          )}
        </Card>

        <Button
          title="Your Coach"
          variant="secondary"
          onPress={() => {
            actionHaptic();
            setCoachPickerOpen((open) => !open);
          }}
          style={styles.actionButton}
        />
        {coachPickerOpen ? (
          <Card style={styles.coachPickerCard}>
            {COACH_PROFILES.map((coach, index) => {
              const selected = coach.voice === coachVoice;
              return (
                <React.Fragment key={coach.voice}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: coachSaving }}
                    disabled={coachSaving}
                    onPress={() => void handleCoachSelection(coach.voice)}
                    style={({ pressed }) => [
                      styles.coachOption,
                      {
                        backgroundColor: selected ? colors.accentMuted : "transparent",
                        opacity: pressed || coachSaving ? 0.72 : 1,
                      },
                    ]}
                  >
                    <View style={styles.coachOptionCopy}>
                      <Text style={[styles.coachOptionName, { color: colors.text }]}>{coach.name}</Text>
                      <Text style={[styles.coachOptionDescription, { color: colors.textSecondary }]}>
                        {coach.description}
                      </Text>
                    </View>
                    {coach.recommended ? (
                      <Text style={[styles.coachSelected, { color: colors.accent }]}>Recommended</Text>
                    ) : null}
                  </Pressable>
                </React.Fragment>
              );
            })}
          </Card>
        ) : null}

        <Button
          title="How to use Court Coach AI"
          variant="secondary"
          onPress={() => {
            actionHaptic();
            router.push("/coach-guide");
          }}
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

function ProfileRowsSkeleton({ rows }: { rows: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <React.Fragment key={index}>
          <View style={styles.row}>
            <Skeleton width={105} height={14} borderRadius={6} />
            <Skeleton width={index === rows - 1 ? 125 : 82} height={16} borderRadius={6} />
          </View>
          {index < rows - 1 ? <Divider /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

function AthletePreferencePicker({
  label,
  options,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  options: { label: string; value: string }[];
  selected: string | null;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.athletePreference}>
      <Text style={[styles.athletePreferenceLabel, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.athleteOptions}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => [
                styles.athleteOption,
                {
                  backgroundColor: active ? colors.accent : colors.cardAlt,
                  borderColor: active ? colors.accent : colors.border,
                  opacity: disabled || pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.athleteOptionText,
                  { color: active ? "#FFFFFF" : colors.text },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  athletePreference: {
    paddingVertical: 4,
  },
  athletePreferenceLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 9,
  },
  athleteOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  athleteOption: {
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  athleteOptionText: {
    fontSize: 12,
    fontWeight: "700",
  },
  trainingUpdateNotice: {
    marginTop: 14,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  trainingUpdateNoticeText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
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
  reminderSkeletonRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  reminderSkeletonCopy: {
    flex: 1,
    gap: 9,
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
  coachPickerCard: {
    marginTop: -4,
    marginBottom: 16,
  },
  coachOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  coachOptionCopy: {
    flex: 1,
  },
  coachOptionName: {
    fontSize: 15,
    fontWeight: "800",
  },
  coachOptionDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  coachSelected: {
    fontSize: 12,
    fontWeight: "800",
  },
});
