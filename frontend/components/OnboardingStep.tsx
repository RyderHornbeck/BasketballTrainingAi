import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeftIcon } from "phosphor-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Text } from "./Text";

interface OnboardingStepProps {
  title: string;
  subtitle?: string;
  step: number;
  totalSteps: number;
  children: React.ReactNode;
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
}

export function OnboardingStep({
  title,
  subtitle,
  step,
  totalSteps,
  children,
  onNext,
  onBack,
  nextLabel = "Continue",
  nextDisabled,
  nextLoading,
}: OnboardingStepProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const progressWidth = `${Math.max(0, Math.min(1, step / totalSteps)) * 100}%` as const;

  return (
    <LinearGradient
      colors={["rgba(247,179,121,0.30)", colors.background, colors.background]}
      locations={[0, 0.42, 1]}
      style={styles.container}
    >
      <View style={[styles.progressWrapper, { paddingTop: insets.top + 18 }]}>
        <View style={styles.progressRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [styles.backArrow, { opacity: pressed ? 0.65 : 1 }]}
          >
            <ArrowLeftIcon size={21} color={colors.text} weight="bold" />
          </Pressable>
          <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: progressWidth,
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
              },
            ]}
          />
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        ) : null}

        <View style={styles.questions}>{children}</View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, backgroundColor: "transparent" },
        ]}
      >
        <Button
          title={nextLabel}
          onPress={onNext}
          disabled={nextDisabled}
          loading={nextLoading}
          style={styles.nextButton}
        />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backArrow: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    marginTop: 12,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 8,
    lineHeight: 21,
  },
  questions: {
    marginTop: 24,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  nextButton: {
    width: "100%",
  },
});
