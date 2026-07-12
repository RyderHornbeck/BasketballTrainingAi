import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { requestPlanGeneration } from "@/lib/plan";
import { Redirect } from "expo-router";
import { CheckCircleIcon, CircleIcon, SmileySadIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

const GENERATION_STEPS = [
  "Reviewing your player profile",
  "Evaluating strengths and weaknesses",
  "Finding drills that match your goals",
  "Balancing intensity and recovery",
  "Finalizing your first five workouts",
];

export default function GeneratingScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { appState, generationRequest, loading, refresh } = usePlan();
  const [retrying, setRetrying] = useState(false);
  const [completedSteps, setCompletedSteps] = useState(0);
  const isFailed = appState === "plan_failed";
  const hasNoRequestYet = !loading && appState === "no_plan" && !generationRequest;
  const isBuilding = loading || (!isFailed && !hasNoRequestYet && appState !== "plan_ready");

  // Belt-and-suspenders: make sure we have a push token while they wait.
  useEffect(() => {
    if (user?.id) registerForPushNotificationsAsync(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!isBuilding) return;
    setCompletedSteps(0);
    const interval = setInterval(() => {
      setCompletedSteps((count) => Math.min(GENERATION_STEPS.length, count + 1));
    }, 5000);
    return () => clearInterval(interval);
  }, [generationRequest?.id, isBuilding]);

  if (appState === "plan_ready") {
    return <Redirect href="/(tabs)/days" />;
  }

  const handleRetry = async () => {
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

        {isBuilding && (
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
                    ) : (
                      <CircleIcon
                        size={25}
                        color={active ? colors.accent : colors.textMuted}
                        weight={active ? "bold" : "regular"}
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
              You can leave the app — we&apos;ll notify you when your plan is ready.
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

        {hasNoRequestYet && (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Ready to build your plan?</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We&apos;ll create your first five personalized workouts based on your answers.
            </Text>
            <Button title="Generate My Plan" onPress={handleRetry} loading={retrying} style={styles.button} />
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
