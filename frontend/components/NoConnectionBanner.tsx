import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  dismissConnectionBanner,
  getConnectivitySnapshot,
  subscribeConnectivity,
  updateNetworkConnectivity,
} from "@/lib/connectivity";
import NetInfo from "@react-native-community/netinfo";
import { WifiSlashIcon } from "phosphor-react-native";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        if (state.isConnected == null && state.isInternetReachable == null) return;
        updateNetworkConnectivity(
          state.isConnected === false || state.isInternetReachable === false
        );
      }),
    []
  );

  return (
    <View style={styles.provider}>
      {children}
      <NoConnectionBanner />
    </View>
  );
}

export function NoConnectionBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot
  );
  const visible =
    snapshot.failureRevision > 0 &&
    snapshot.failureRevision > snapshot.dismissedRevision;
  const [translateY] = useState(() => new Animated.Value(-120));

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(-120);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.8,
    }).start();
  }, [snapshot.failureRevision, translateY, visible]);

  const dismiss = useMemo(
    () => () => {
      Animated.timing(translateY, {
        toValue: -120,
        duration: 180,
        useNativeDriver: true,
      }).start(dismissConnectionBanner);
    },
    [translateY]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy < -5,
        onPanResponderMove: (_, gesture) => {
          translateY.setValue(Math.min(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy < -28 || gesture.vy < -0.5) {
            dismiss();
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dismiss, translateY]
  );

  if (!visible) return null;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      {...panResponder.panHandlers}
      style={[
        styles.banner,
        {
          top: insets.top + 8,
          backgroundColor: colors.card,
          borderColor: colors.danger,
          shadowColor: colors.shadow,
          transform: [{ translateY }],
        },
      ]}
    >
      <WifiSlashIcon size={21} color={colors.danger} weight="bold" />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>No connection</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Check your internet connection and try again.
        </Text>
      </View>
      <Text style={[styles.dismissHint, { color: colors.textMuted }]}>Swipe up</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
  },
  banner: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 10_000,
    elevation: 30,
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 15,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  dismissHint: {
    fontSize: 9,
    fontWeight: "700",
  },
});
