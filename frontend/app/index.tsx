import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { useSubscription } from "@/hooks/useSubscription";
import { prepareAnalyticsSummary } from "@/lib/analytics";
import { loadOnboardingDraft } from "@/lib/onboardingDraft";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

export default function Index() {
  const { colors } = useTheme();
  const { user, profile, loading: authLoading, startupError, retryStartup } = useAuth();
  const { appState, loading, loadError, refresh } = usePlan();
  const { hasPremium, isLoadingSubscription } = useSubscription();
  const [draftState, setDraftState] = useState<{
    userId: string;
    exists: boolean;
  } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    void prepareAnalyticsSummary(user.id).catch((error) => {
      console.warn("Unable to prepare analytics during startup:", error);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || authLoading || profile?.onboarding_completed) return;
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (!cancelled) setDraftState({ userId: user.id, exists: Boolean(draft) });
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, profile?.onboarding_completed, user?.id]);

  if (startupError) {
    return (
      <View style={[styles.center, { backgroundColor: "transparent", paddingHorizontal: 32 }]}>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Couldn&apos;t open Court Coach</Text>
        <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>{startupError}</Text>
        <Button title="Try Again" onPress={retryStartup} style={styles.retryButton} />
      </View>
    );
  }

  if (authLoading) return <IndexLoading />;
  if (!user) return <Redirect href="/welcome" />;
  if (isLoadingSubscription) return <IndexLoading />;

  if (!profile?.onboarding_completed) {
    const draftExists =
      draftState && draftState.userId === user.id ? draftState.exists : null;
    if (draftExists === null) return <IndexLoading />;
    if (!draftExists) return <Redirect href="/onboarding" />;
    if (!hasPremium) {
      return <Redirect href={{ pathname: "/paywall", params: { next: "finish-setup" } }} />;
    }
    return <Redirect href="/finish-setup" />;
  }

  if (!hasPremium) {
    return <Redirect href={{ pathname: "/paywall", params: { next: "generating" } }} />;
  }

  if (loadError) {
    return (
      <View style={[styles.center, { backgroundColor: "transparent", paddingHorizontal: 32 }]}>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Couldn&apos;t load your workouts</Text>
        <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>{loadError}</Text>
        <Button title="Try Again" onPress={() => void refresh()} style={styles.retryButton} />
      </View>
    );
  }

  if (loading) {
    return <IndexLoading />;
  }

  switch (appState) {
    case "logged_out":
      return <Redirect href="/welcome" />;
    case "onboarding_incomplete":
      return <Redirect href="/onboarding" />;
    case "plan_generating":
    case "no_plan":
      return <Redirect href="/(tabs)/days" />;
    case "plan_failed":
      return <Redirect href="/generating" />;
    case "plan_ready":
      return <Redirect href="/(tabs)/days" />;
    default:
      return <IndexLoading />;
  }
}

function IndexLoading() {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Court Coach"
      style={styles.center}
    >
      <Skeleton width={84} height={84} borderRadius={42} />
      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
        Loading Court Coach…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  errorMessage: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  loadingText: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 24,
    minWidth: 180,
  },
});
