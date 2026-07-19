import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { Redirect } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

export default function Index() {
  const { colors } = useTheme();
  const { startupError, retryStartup } = useAuth();
  const { appState, loading, loadError, refresh } = usePlan();

  if (startupError) {
    return (
      <View style={[styles.center, { backgroundColor: "transparent", paddingHorizontal: 32 }]}>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Couldn&apos;t open Court Coach</Text>
        <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>{startupError}</Text>
        <Button title="Try Again" onPress={retryStartup} style={styles.retryButton} />
      </View>
    );
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
    return null;
  }

  switch (appState) {
    case "logged_out":
      return <Redirect href="/welcome" />;
    case "onboarding_incomplete":
      return <Redirect href="/onboarding" />;
    case "plan_generating":
    case "plan_failed":
    case "no_plan":
      return <Redirect href="/generating" />;
    case "plan_ready":
      return <Redirect href="/(tabs)/days" />;
    default:
      return null;
  }
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
