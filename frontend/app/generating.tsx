import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { requestPlanGeneration } from "@/lib/plan";
import { Redirect } from "expo-router";
import { BasketballIcon, SmileySadIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

export default function GeneratingScreen() {
  const { colors } = useTheme();
  const { appState, generationRequest, loading, refresh } = usePlan();
  const [retrying, setRetrying] = useState(false);
  const isFailed = appState === "plan_failed";
  const hasNoRequestYet = !loading && appState === "no_plan" && !generationRequest;

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

  if (appState === "plan_ready") {
    return <Redirect href="/(tabs)/days" />;
  }
  if (!loading && appState === "onboarding_incomplete") {
    return <Redirect href="/onboarding" />;
  }
  if (!loading && appState === "logged_out") {
    return <Redirect href="/welcome" />;
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

        {!isFailed && (
          <>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.accentMuted, borderColor: colors.border },
              ]}
            >
              <BasketballIcon size={54} color={colors.accent} weight="duotone" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Finishing your setup…</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Your account is ready. We&apos;re putting the final touches on your personalized
              workouts.
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
  iconCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
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
