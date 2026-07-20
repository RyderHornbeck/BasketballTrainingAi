import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface PaywallStateProps {
  kind: "loading" | "error";
  textColor: string;
  mutedColor: string;
  accentColor: string;
  message?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
}

export function PaywallState({
  kind,
  textColor,
  mutedColor,
  accentColor,
  message,
  onRetry,
  onSignOut,
}: PaywallStateProps) {
  if (kind === "loading") {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading subscription options"
        style={styles.container}
      >
        <Skeleton width={82} height={82} borderRadius={24} />
        <Skeleton width="76%" height={30} borderRadius={10} />
        <Skeleton width="92%" height={18} borderRadius={8} />
        <Skeleton width="100%" height={112} borderRadius={22} />
        <Skeleton width="100%" height={112} borderRadius={22} />
        <Skeleton width="100%" height={54} borderRadius={27} />
      </View>
    );
  }

  return (
    <View style={styles.errorContainer}>
      <Text style={[styles.errorTitle, { color: textColor }]}>
        Subscription options unavailable
      </Text>
      <Text accessibilityRole="alert" style={[styles.errorMessage, { color: mutedColor }]}>
        {message ?? "Check your connection and try again."}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: accentColor, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
      ) : null}
      {onSignOut ? (
        <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut}>
          <Text style={[styles.signOutText, { color: mutedColor }]}>Sign Out</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 23,
    fontWeight: "800",
    textAlign: "center",
  },
  errorMessage: {
    maxWidth: 340,
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retry: {
    minWidth: 170,
    minHeight: 50,
    marginTop: 24,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  signOut: {
    minHeight: 44,
    marginTop: 10,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  signOutText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
