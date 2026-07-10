import { useTheme } from "@/hooks/useTheme";
import React, { useEffect } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const progress = useSharedValue(step / totalSteps);

  useEffect(() => {
    progress.value = withTiming(step / totalSteps, { duration: 380 });
  }, [step, totalSteps, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));

  return (
    <View style={styles.container}>
      <View style={[styles.progressWrapper, { paddingTop: insets.top + 18 }]}>
        <View style={styles.progressHeaderRow}>
          <Text style={[styles.stepLabel, { color: colors.textMuted }]}>
            Step {step} of {totalSteps}
          </Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
          <Animated.View
            style={[
              styles.progressFill,
              fillStyle,
              {
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
              },
            ]}
          />
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

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.shadow,
            },
            scheme === "dark" ? styles.cardShadowDark : styles.cardShadowLight,
          ]}
        >
          {children}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, backgroundColor: "transparent" },
        ]}
      >
        {onBack ? (
          <Button title="Back" variant="outline" onPress={onBack} style={styles.backButton} />
        ) : null}
        <Button
          title={nextLabel}
          onPress={onNext}
          disabled={nextDisabled}
          loading={nextLoading}
          style={styles.nextButton}
        />
      </View>
    </View>
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
  progressHeaderRow: {
    marginBottom: 10,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  progressTrack: {
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
  card: {
    marginTop: 24,
    borderRadius: 26,
    borderWidth: 1,
    padding: 20,
  },
  cardShadowDark: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 6,
  },
  cardShadowLight: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
  },
  backButton: {
    flex: 1,
  },
  nextButton: {
    flex: 2,
  },
});
