import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { reportNetworkFailure } from "@/lib/connectivity";
import { actionHaptic, selectionHaptic } from "@/lib/haptics";
import {
  emitTrainingPreferenceUpdated,
  TrainingPreferenceField,
} from "@/lib/trainingPreferenceEvents";
import { supabase } from "@/lib/supabase";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeftIcon, CheckCircleIcon, CircleIcon } from "phosphor-react-native";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface PreferenceOption {
  label: string;
  value: string;
}

interface PreferenceConfig {
  title: string;
  subtitle: string;
  options: PreferenceOption[];
}

const CONFIG: Record<TrainingPreferenceField, PreferenceConfig> = {
  overall_skill_level: {
    title: "Update skill level",
    subtitle: "Choose the level that best matches the workouts you want next.",
    options: [
      { label: "Beginner", value: "beginner" },
      {
        label: "Intermediate",
        value: "intermediate",
      },
      { label: "Advanced", value: "advanced" },
      { label: "Elite", value: "elite" },
    ],
  },
  position: {
    title: "Update position",
    subtitle: "Choose the role that should influence your future drill selection.",
    options: [
      { label: "Guard", value: "Guard" },
      { label: "Wing", value: "Wing" },
      { label: "Big", value: "Big" },
      { label: "No preference", value: "Unknown" },
    ],
  },
  minutes_per_workout: {
    title: "Update workout time",
    subtitle: "Choose how much time future workouts should be designed to fill.",
    options: [15, 30, 45, 60, 75, 90].map((minutes) => ({
      label: `${minutes} minutes`,
      value: String(minutes),
    })),
  },
};

function isPreferenceField(value: string | undefined): value is TrainingPreferenceField {
  return (
    value === "overall_skill_level" ||
    value === "position" ||
    value === "minutes_per_workout"
  );
}

export default function EditTrainingPreferenceScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ field?: string; current?: string }>();
  const field = isPreferenceField(params.field) ? params.field : null;
  const config = field ? CONFIG[field] : null;
  const initialValue = typeof params.current === "string" ? params.current : "";
  const [selected, setSelected] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const selectedIsValid = useMemo(
    () => Boolean(config?.options.some((option) => option.value === selected)),
    [config, selected]
  );

  const handleSave = async () => {
    if (!user || !field || !selectedIsValid || saving) return;
    actionHaptic();
    setSaving(true);
    const value = field === "minutes_per_workout" ? Number(selected) : selected;
    const { error } = await supabase
      .from("onboarding_answers")
      .update({ [field]: value })
      .eq("user_id", user.id);

    if (error) {
      reportNetworkFailure("athlete-preferences");
      Alert.alert("Could not save your change", "Please check your connection and try again.");
      setSaving(false);
      return;
    }

    emitTrainingPreferenceUpdated({ field, value });
    router.back();
  };

  if (!config || !field) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.invalidState}>
          <Text style={[styles.title, { color: colors.text }]}>Setting unavailable</Text>
          <Button title="Go Back" onPress={() => router.back()} style={styles.invalidButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: "transparent" }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Profile"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ArrowLeftIcon size={23} color={colors.text} weight="bold" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.title, { color: colors.text }]}>{config.title}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {config.subtitle}
        </Text>

        <View style={styles.optionList}>
          {config.options.map((option) => {
            const active = option.value === selected;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  selectionHaptic();
                  setSelected(option.value);
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.card,
                    borderColor: active ? colors.accent : colors.border,
                    shadowColor: colors.shadow,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <Text style={[styles.optionTitle, { color: colors.text }]}>{option.label}</Text>
                {active ? (
                  <CheckCircleIcon size={25} color={colors.accent} weight="fill" />
                ) : (
                  <CircleIcon size={25} color={colors.textMuted} weight="regular" />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Button
          title="Save"
          onPress={() => void handleSave()}
          disabled={!selectedIsValid}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    height: 52,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 9,
    fontSize: 14,
    lineHeight: 21,
  },
  optionList: {
    marginTop: 28,
    gap: 12,
  },
  option: {
    minHeight: 60,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 17,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  optionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 13,
    paddingBottom: 10,
  },
  invalidState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  invalidButton: {
    minWidth: 160,
    marginTop: 22,
  },
});
