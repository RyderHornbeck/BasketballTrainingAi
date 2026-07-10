import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function Index() {
  const { colors } = useTheme();
  const { appState, loading } = usePlan();

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: "transparent" }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
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
});
