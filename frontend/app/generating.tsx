import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { requestPlanGeneration } from "@/lib/plan";
import { Redirect, router } from "expo-router";
import { SmileySadIcon } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

const GENERATION_TIMEOUT_MS = 10_000;
const GENERATION_STAGES = [
  "Finishing up your account",
  "Pulling your workout drills",
  "Saving your personalized five-day plan",
  "Getting your first workout ready",
] as const;

export default function GeneratingScreen() {
  const { colors } = useTheme();
  const { appState, generationRequest, loading, refresh } = usePlan();
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState(0.08);
  const [timedOut, setTimedOut] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const ensuredRequestsRef = useRef(new Set<string>());
  const generationStartedAtRef = useRef<number | null>(null);
  const navigationScheduledRef = useRef(false);
  const isFailed = appState === "plan_failed";
  const hasNoRequestYet = !loading && appState === "no_plan" && !generationRequest;
  const hasPendingRequest = !loading && generationRequest?.status === "pending";

  useEffect(() => {
    if (!hasNoRequestYet && !hasPendingRequest) return;
    const requestKey = generationRequest?.id ?? "new-request";
    if (ensuredRequestsRef.current.has(requestKey)) return;
    ensuredRequestsRef.current.add(requestKey);
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      setRetrying(true);
      void requestPlanGeneration()
        .then((request) => {
          ensuredRequestsRef.current.add(request.id);
          return refresh();
        })
        .catch((generationError) => {
          console.error("Unable to continue plan generation:", generationError);
          if (!cancelled) {
            setRetryError(
              generationError instanceof Error
                ? generationError.message
                : "Unable to start plan generation."
            );
          }
        })
        .finally(() => {
          if (!cancelled) setRetrying(false);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [generationRequest?.id, hasNoRequestYet, hasPendingRequest, refresh]);

  useEffect(() => {
    if (isFailed || timedOut || appState === "plan_ready") return;
    if (generationStartedAtRef.current === null) {
      generationStartedAtRef.current = Date.now();
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - (generationStartedAtRef.current ?? Date.now());
      const nextProgress = Math.min(
        0.92,
        0.08 + (elapsed / GENERATION_TIMEOUT_MS) * 0.84
      );
      setProgress((current) => Math.max(current, nextProgress));
      if (elapsed >= GENERATION_TIMEOUT_MS) setTimedOut(true);
    }, 300);
    return () => clearInterval(interval);
  }, [appState, isFailed, timedOut]);

  useEffect(() => {
    if (appState !== "plan_ready" || navigationScheduledRef.current) return;
    navigationScheduledRef.current = true;
    const frame = requestAnimationFrame(() => setProgress(1));
    const timeout = setTimeout(() => {
      router.replace("/(tabs)/days");
    }, 450);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [appState]);

  if (!loading && appState === "onboarding_incomplete") {
    return <Redirect href="/onboarding" />;
  }
  if (!loading && appState === "logged_out") {
    return <Redirect href="/welcome" />;
  }

  const handleRetry = async () => {
    setRetrying(true);
    setTimedOut(false);
    setRetryError(null);
    setProgress(0.08);
    generationStartedAtRef.current = Date.now();
    ensuredRequestsRef.current.clear();
    try {
      const request = await requestPlanGeneration();
      ensuredRequestsRef.current.add(request.id);
      await refresh();
    } catch (generationError) {
      setRetryError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to continue plan generation."
      );
    } finally {
      setRetrying(false);
    }
  };

  const currentStageIndex =
    progress < 0.3 ? 0 : progress < 0.55 ? 1 : progress < 0.78 ? 2 : 3;
  const showRecovery = isFailed || timedOut;

  return (
    <View style={[styles.container, { backgroundColor: "transparent" }]}>
      <View style={styles.content}>
        {showRecovery ? (
          <SmileySadIcon size={64} color={colors.textSecondary} weight="duotone" />
        ) : (
          <>
            <Image
              accessibilityLabel="Court Coach AI"
              source={require("../assets/images/AppLogo.png")}
              resizeMode="contain"
              style={styles.logo}
            />
            <Text style={[styles.title, { color: colors.text }]}>
              Finishing up your account…
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Your plan is being safely saved before we open your workouts.
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(progress * 100),
              }}
              style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.accent,
                    width: `${Math.round(progress * 100)}%` as `${number}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              {Math.round(progress * 100)}%
            </Text>
            <View style={styles.stageList}>
              {GENERATION_STAGES.map((stage, index) => {
                const completed = index < currentStageIndex || progress === 1;
                const active = index === currentStageIndex && progress < 1;
                return (
                  <View key={stage} style={styles.stageRow}>
                    <Text
                      style={[
                        styles.stageMarker,
                        {
                          color: completed || active ? colors.accent : colors.textMuted,
                        },
                      ]}
                    >
                      {completed ? "✓" : active ? "●" : "○"}
                    </Text>
                    <Text
                      style={[
                        styles.stageText,
                        {
                          color:
                            completed || active ? colors.text : colors.textMuted,
                        },
                        active && styles.activeStageText,
                      ]}
                    >
                      {stage}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {showRecovery && (
          <>
            <Text style={[styles.title, { color: colors.text }]}>
              {isFailed ? "Something went wrong." : "This is taking longer than expected."}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Your purchase is safe. Check your connection, then try loading the plan again.
            </Text>
            {generationRequest?.error_message || retryError ? (
              <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={3}>
                {generationRequest?.error_message ?? retryError}
              </Text>
            ) : null}
            <Button
              title="Try Again"
              onPress={handleRetry}
              loading={retrying}
              style={styles.button}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  logo: {
    width: 92,
    height: 92,
    marginBottom: 24,
  },
  subtitle: {
    maxWidth: 340,
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 20,
  },
  progressTrack: {
    width: "100%",
    maxWidth: 340,
    height: 12,
    marginTop: 30,
    borderRadius: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
  },
  progressText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
  },
  stageList: {
    width: "100%",
    maxWidth: 340,
    marginTop: 25,
    gap: 13,
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stageMarker: {
    width: 24,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  stageText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 13,
    fontWeight: "500",
  },
  activeStageText: {
    fontWeight: "700",
  },
  button: {
    marginTop: 28,
    minWidth: 200,
  },
});
