import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { requestPlanGeneration } from "@/lib/plan";
import { Redirect, useLocalSearchParams } from "expo-router";
import { CheckCircleIcon, CircleIcon, SmileySadIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

const GENERATION_STEPS = [
  "Calculating your workout length",
  "Reading your goals and skill levels",
  "Finding exercises tailored to you",
  "Balancing drill categories and difficulty",
  "Scheduling your first five workouts",
];
const STEP_DURATION_MS = 1_000;
const CHECKLIST_DURATION_MS = GENERATION_STEPS.length * STEP_DURATION_MS;
const checklistStartBySession = new Map<string, number>();

export default function GeneratingScreen() {
  const { colors } = useTheme();
  const { checklist, checklistSession } = useLocalSearchParams<{
    checklist?: string;
    checklistSession?: string;
  }>();
  const { appState, generationRequest, loading, refresh } = usePlan();
  const holdForChecklist = checklist === "1";
  const sessionKey = checklistSession ?? "unkeyed";
  const [checklistStartedAt, setChecklistStartedAt] = useState(() => {
    if (!holdForChecklist) return Date.now();
    const existingStart = checklistStartBySession.get(sessionKey);
    if (existingStart != null) return existingStart;
    const start = Date.now();
    checklistStartBySession.set(sessionKey, start);
    return start;
  });
  const initialElapsed = Math.max(0, Date.now() - checklistStartedAt);
  const [retrying, setRetrying] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(() =>
    Math.min(GENERATION_STEPS.length, Math.floor(initialElapsed / STEP_DURATION_MS))
  );
  const [checklistFinished, setChecklistFinished] = useState(
    () => initialElapsed >= CHECKLIST_DURATION_MS
  );
  const isFailed = appState === "plan_failed";
  const hasNoRequestYet = !loading && appState === "no_plan" && !generationRequest;
  const showChecklist = holdForChecklist
    ? !isFailed
    : !loading &&
      !isFailed &&
      appState !== "onboarding_incomplete" &&
      appState !== "logged_out";

  useEffect(() => {
    if (!hasNoRequestYet || retrying) return;
    void (async () => {
      setRetrying(true);
      try {
        await requestPlanGeneration();
        await refresh();
      } finally {
        setRetrying(false);
      }
    })();
  }, [hasNoRequestYet, refresh, retrying]);

  useEffect(() => {
    if (!showChecklist) return;
    const elapsed = Math.max(0, Date.now() - checklistStartedAt);
    const alreadyCompleted = Math.min(
      GENERATION_STEPS.length,
      Math.floor(elapsed / STEP_DURATION_MS)
    );
    setCompletedSteps(alreadyCompleted);
    setChecklistFinished(elapsed >= CHECKLIST_DURATION_MS);

    const timeouts = GENERATION_STEPS.flatMap((_, index) => {
      const delay = (index + 1) * STEP_DURATION_MS - elapsed;
      if (delay <= 0) return [];
      return [setTimeout(() => {
        setCompletedSteps(index + 1);
        if (index === GENERATION_STEPS.length - 1) {
          setChecklistFinished(true);
        }
      }, delay)];
    });
    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [checklistStartedAt, showChecklist]);

  if (loading && !holdForChecklist) {
    return (
      <View style={[styles.container, { backgroundColor: "transparent" }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // Expo can restore this route after an OTA reload, even when the plan was
  // generated long ago. Never make an existing member wait for the cosmetic
  // checklist before returning them to their ready workout.
  if (appState === "plan_ready" && (!holdForChecklist || checklistFinished)) {
    return <Redirect href="/(tabs)/days" />;
  }
  if (!loading && appState === "onboarding_incomplete") {
    return <Redirect href="/onboarding" />;
  }
  if (!loading && appState === "logged_out") {
    return <Redirect href="/welcome" />;
  }

  const handleRetry = async () => {
    const restartAt = Date.now();
    checklistStartBySession.set(sessionKey, restartAt);
    setChecklistStartedAt(restartAt);
    setRetrying(true);
    try {
      await requestPlanGeneration();
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: "transparent" }]}>
      <View style={styles.content}>
        {isFailed ? (
          <SmileySadIcon size={64} color={colors.textSecondary} weight="duotone" />
        ) : null}

        {showChecklist && (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Building your first five workouts...</Text>
            <View style={styles.steps}>
              {GENERATION_STEPS.map((label, index) => {
                const complete = index < completedSteps;
                const active = index === completedSteps;
                return (
                  <View
                    key={label}
                    style={[
                      styles.stepRow,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    {complete ? (
                      <CheckCircleIcon size={25} color="#35B96F" weight="fill" />
                    ) : active ? (
                      <View style={styles.stepIndicator}>
                        <ActivityIndicator size="small" color={colors.accent} />
                      </View>
                    ) : (
                      <CircleIcon
                        size={25}
                        color={colors.textMuted}
                        weight="regular"
                      />
                    )}
                    <Text
                      style={[
                        styles.stepText,
                        { color: complete || active ? colors.text : colors.textMuted },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {checklistFinished && appState !== "plan_ready"
                ? "Putting the finishing touches on your plan."
                : "Personalizing your first five workouts."}
            </Text>
          </>
        )}

        {isFailed && (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Something went wrong. Try again.</Text>
            {generationRequest?.error_message ? (
              <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={3}>
                {generationRequest.error_message}
              </Text>
            ) : null}
            <Button title="Try Again" onPress={handleRetry} loading={retrying} style={styles.button} />
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
  steps: {
    width: "100%",
    gap: 10,
    marginTop: 26,
  },
  stepRow: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  stepIndicator: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 20,
  },
  button: {
    marginTop: 28,
    minWidth: 200,
  },
});
