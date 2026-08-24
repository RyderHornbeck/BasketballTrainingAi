import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useSubscription } from "@/hooks/useSubscription";
import { prepareAnalyticsSummary } from "@/lib/analytics";
import { loadOnboardingDraft } from "@/lib/onboardingDraft";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

export default function Index() {
  const { colors } = useTheme();
  const { user, profile, loading: authLoading, startupError, retryStartup } = useAuth();
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
    void loadOnboardingDraft()
      .then((draft) => {
        if (!cancelled) setDraftState({ userId: user.id, exists: Boolean(draft) });
      })
      .catch(() => {
        if (!cancelled) setDraftState({ userId: user.id, exists: false });
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

  if (authLoading) return <IndexPending />;
  if (!user) return <Redirect href="/welcome" />;
  if (isLoadingSubscription) return <IndexPending />;

  if (!profile?.onboarding_completed) {
    const draftExists =
      draftState && draftState.userId === user.id ? draftState.exists : null;
    if (draftExists === null) return <IndexPending />;
    if (!draftExists) return <Redirect href="/onboarding" />;
    if (!hasPremium) {
      return <Redirect href={{ pathname: "/paywall", params: { next: "finish-setup" } }} />;
    }
    return <Redirect href="/finish-setup" />;
  }

  if (!hasPremium) {
    return <Redirect href={{ pathname: "/paywall", params: { next: "generating" } }} />;
  }

  // Workout loading and generation are rendered by the Workouts tab itself.
  // Never hold a paid user on an intermediate startup screen.
  return <Redirect href="/(tabs)/days" />;
}

function IndexPending() {
  return <View style={styles.center} />;
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
  retryButton: {
    marginTop: 24,
    minWidth: 180,
  },
});
