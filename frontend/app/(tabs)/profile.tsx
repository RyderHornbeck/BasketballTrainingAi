import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ThemeMode } from "@/components/ThemeProvider";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { clearOnboardingDraft } from "@/lib/onboardingDraft";
import { regeneratePlan } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { OnboardingAnswers } from "@/types/database";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const { user, profile, signOut } = useAuth();
  const [answers, setAnswers] = useState<OnboardingAnswers | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("onboarding_answers")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setAnswers((data as OnboardingAnswers) ?? null);
        setLoading(false);
      });
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/auth/login");
  };

  const handleRegenerate = () => {
    Alert.alert(
      "Generate a new plan?",
      "This is intended for testing. Your current plan remains available until the new plan is ready.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Generate",
          onPress: async () => {
            setRegenerating(true);
            try {
              await regeneratePlan();
              router.replace("/generating");
            } catch (err) {
              Alert.alert(
                "Generation failed",
                err instanceof Error ? err.message : "Unable to generate a new plan."
              );
            } finally {
              setRegenerating(false);
            }
          },
        },
      ]
    );
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
              setAnswers(null);
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

        <Card style={styles.card}>
          <ProfileRow label="Email" value={profile?.email ?? user?.email ?? "--"} />
        </Card>

        <Card style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <ProfileRow label="Skill Level" value={capitalize(answers?.overall_skill_level) ?? "--"} />
              <Divider />
              <ProfileRow label="Main Goal" value={answers?.main_goal ?? "--"} />
              <Divider />
              <ProfileRow label="Training Days / Week" value={answers?.days_per_week ? String(answers.days_per_week) : "--"} />
              <Divider />
              <ProfileRow
                label="Workout Length"
                value={answers?.minutes_per_workout ? `${answers.minutes_per_workout} min` : "--"}
              />
            </>
          )}
        </Card>

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

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Testing</Text>
        <Button
          title="Generate New Plan"
          variant="secondary"
          onPress={handleRegenerate}
          loading={regenerating}
          style={styles.actionButton}
        />

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

function capitalize(s?: string | null) {
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
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
});
