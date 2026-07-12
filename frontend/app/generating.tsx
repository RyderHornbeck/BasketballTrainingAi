import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { requestPlanGeneration } from "@/lib/plan";
import { Redirect } from "expo-router";
import { BasketballIcon, SmileySadIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function GeneratingScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { appState, generationRequest, loading, refresh } = usePlan();
  const [retrying, setRetrying] = useState(false);

  // Belt-and-suspenders: make sure we have a push token while they wait.
  useEffect(() => {
    if (user?.id) registerForPushNotificationsAsync(user.id);
  }, [user?.id]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: "transparent" }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

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

  const isFailed = appState === "plan_failed";
  const hasNoRequestYet = appState === "no_plan" && !generationRequest;

  return (
    <View style={[styles.container, { backgroundColor: "transparent" }]}>
      <View style={styles.content}>
        {isFailed ? (
          <SmileySadIcon size={64} color={colors.textSecondary} weight="duotone" />
        ) : (
          <BasketballIcon size={64} color={colors.accent} weight="duotone" />
        )}

        {!isFailed && !hasNoRequestYet && (
          <>
            <ActivityIndicator size="large" color={colors.accent} style={styles.spinner} />
            <Text style={[styles.title, { color: colors.text }]}>Building your first five workouts...</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Our AI coach is analyzing your answers and picking a balanced five-workout block. This
              usually takes less than a minute. You can leave the app — we&apos;ll notify you when your
              plan is ready.
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  spinner: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
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
