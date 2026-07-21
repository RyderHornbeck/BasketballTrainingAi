import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useTheme } from "@/hooks/useTheme";
import { clearOnboardingDraft, loadOnboardingDraft } from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { Redirect, router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

const SETUP_STEP_TIMEOUT_MS = 15_000;

function withSetupTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} is taking too long. Check your connection and try again.`));
    }, SETUP_STEP_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export default function FinishSetupScreen() {
  const { colors } = useTheme();
  const { user, refreshProfile } = useAuth();
  const { hasPremium, isLoadingSubscription } = useSubscription();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedAttemptRef = useRef<number | null>(null);

  const finishSetup = useCallback(async () => {
    if (!user?.id || !hasPremium) return;
    setError(null);
    try {
      const draft = await loadOnboardingDraft();
      if (!draft) {
        await withSetupTimeout(refreshProfile(), "Refreshing your profile");
        router.replace("/");
        return;
      }

      await withSetupTimeout(
        submitOnboardingAnswers(user.id, draft),
        "Saving your preferences"
      );
      await clearOnboardingDraft();
      await withSetupTimeout(refreshProfile(), "Refreshing your profile");
      router.replace({
        pathname: "/paywall",
        params: { next: "generating" },
      });
      void requestPlanGeneration().catch((generationError) => {
        console.error("Unable to start initial plan generation:", generationError);
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "We could not finish setting up your workouts."
      );
    }
  }, [hasPremium, refreshProfile, user]);

  useEffect(() => {
    if (isLoadingSubscription || !hasPremium || startedAttemptRef.current === attempt) return;
    startedAttemptRef.current = attempt;
    const frame = requestAnimationFrame(() => {
      void finishSetup();
    });
    return () => cancelAnimationFrame(frame);
  }, [attempt, finishSetup, hasPremium, isLoadingSubscription]);

  if (!user) return <Redirect href="/welcome" />;
  if (!isLoadingSubscription && !hasPremium) {
    return <Redirect href={{ pathname: "/paywall", params: { next: "finish-setup" } }} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View accessibilityRole="progressbar" accessibilityLabel="Finishing setup" style={styles.card}>
        <Skeleton width={84} height={84} borderRadius={42} />
        <Text style={[styles.title, { color: colors.text }]}>Finishing your setup</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We’re saving your preferences and preparing your first Court Coach plan.
        </Text>
        <Skeleton width="100%" height={14} borderRadius={7} />
        <Skeleton width="78%" height={14} borderRadius={7} />
        {error ? (
          <>
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt((value) => value + 1)}
              style={({ pressed }) => [
                styles.retry,
                { backgroundColor: colors.accent, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={styles.retryText}>Try Again</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    alignItems: "center",
    gap: 14,
  },
  title: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    maxWidth: 340,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 8,
  },
  error: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  retry: {
    minWidth: 150,
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
