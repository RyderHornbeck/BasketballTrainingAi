import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useTheme } from "@/hooks/useTheme";
import { Redirect, useSegments } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

const PUBLIC_SEGMENTS = new Set(["", "index", "welcome", "auth", "onboarding", "paywall"]);

export function SubscriptionRouteGuard({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const { user, profile, loading: authLoading } = useAuth();
  const { hasPremium, isLoadingSubscription } = useSubscription();
  const { colors } = useTheme();
  const rootSegment = segments[0] ?? "";
  const isPublicRoute = PUBLIC_SEGMENTS.has(rootSegment);
  const isTutorialRoute = rootSegment === "tutorial-workout";
  const isFinishSetup = rootSegment === "finish-setup";

  let gate: React.ReactNode = null;

  if (!isPublicRoute && !isTutorialRoute) {
    if (authLoading) {
      gate = <SubscriptionGateLoading />;
    } else if (!user) {
      gate = <Redirect href="/welcome" />;
    } else if (isLoadingSubscription) {
      gate = <SubscriptionGateLoading />;
    } else if (isFinishSetup) {
      if (!hasPremium) {
        gate = (
          <Redirect href={{ pathname: "/paywall", params: { next: "finish-setup" } }} />
        );
      }
    } else if (!profile?.onboarding_completed) {
      gate = <Redirect href="/" />;
    } else if (!hasPremium) {
      gate = <Redirect href={{ pathname: "/paywall", params: { next: "generating" } }} />;
    }
  }

  if (isTutorialRoute) {
    if (authLoading || isLoadingSubscription) {
      gate = <SubscriptionGateLoading />;
    } else if (!user) {
      gate = <Redirect href="/welcome" />;
    } else if (!profile?.onboarding_completed) {
      gate = <Redirect href="/onboarding" />;
    }
  }

  return (
    <View style={[styles.content, { backgroundColor: colors.background }]}>
      {children}
      {gate}
    </View>
  );
}

function SubscriptionGateLoading() {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Checking subscription"
      style={[styles.loading, { backgroundColor: colors.background }]}
    >
      <Skeleton width={88} height={88} borderRadius={44} />
      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
        Checking your Court Coach access…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  loading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 18,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
