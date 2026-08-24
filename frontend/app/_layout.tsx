import { ScreenBackground } from "@/components/ScreenBackground";
import { ConnectivityProvider } from "@/components/NoConnectionBanner";
import { SubscriptionRouteGuard } from "@/components/SubscriptionRouteGuard";
import { ThemeMode, ThemeProvider, useThemeContext } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { buildNavigationTheme } from "@/lib/navigationTheme";
import { flushPendingTimedSetCompletions } from "@/lib/timedSetCompletion";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { Stack, ThemeProvider as NavigationThemeProvider } from "expo-router";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { Animated, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TourProvider, type TooltipRenderProps } from "guideway";

SplashScreen.preventAutoHideAsync().catch(() => {});

const TUTORIAL_SPOTLIGHT_COPY: Record<string, string> = {
  "tutorial-start-workout": "Hey! Let’s begin your tutorial workout. Press Start workout.",
  "tutorial-drills": "These are your two tutorial exercises. Tap either one to continue.",
  "tutorial-coach": "Now let’s start. Press the Court Coach button to talk to me!",
  "tutorial-finish-workout": "Pound Dribbles is complete. Press this to see your finished workout.",
};

function TutorialGuidewayBubble({ step }: TooltipRenderProps) {
  const { colors } = useTheme();
  const [typedMessage, setTypedMessage] = useState("");
  const [scale] = useState(() => new Animated.Value(0.92));
  const message = TUTORIAL_SPOTLIGHT_COPY[step.id] ?? "";

  useEffect(() => {
    scale.setValue(0.92);
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 120,
    }).start();

    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedMessage(message.slice(0, index));
      if (index >= message.length) clearInterval(interval);
    }, 16);
    return () => clearInterval(interval);
  }, [message, scale]);

  return (
    <Animated.View style={[tutorialBubbleStyles.container, { transform: [{ scale }] }]}>
      <View style={[tutorialBubbleStyles.label, { backgroundColor: colors.accent }]}>
        {typedMessage.length >= 8 ? (
          <Text style={tutorialBubbleStyles.labelText}>Court Coach</Text>
        ) : null}
      </View>
      <View style={[tutorialBubbleStyles.bubble, { backgroundColor: colors.card }]}>
        <Text style={[tutorialBubbleStyles.message, { color: colors.text }]}>{typedMessage}</Text>
      </View>
    </Animated.View>
  );
}

const tutorialTour = [
  {
    id: "coach-tutorial",
    steps: [
      {
        id: "tutorial-start-workout",
        cutout: { shape: "rounded" as const, padding: 10, radius: 20 },
        placement: "top" as const,
      },
      {
        id: "tutorial-drills",
        cutout: { shape: "rounded" as const, padding: 8, radius: 18 },
        placement: "top" as const,
      },
      {
        id: "tutorial-coach",
        cutout: { shape: "circle" as const, padding: 10 },
        placement: "top" as const,
      },
      {
        id: "tutorial-finish-workout",
        cutout: { shape: "rounded" as const, padding: 10, radius: 16 },
        placement: "top" as const,
      },
    ],
  },
];

function RootNavigator() {
  const { scheme, colors, setMode } = useThemeContext();
  const { profile } = useAuth();
  const syncedFromProfile = useRef(false);
  const navTheme = useMemo(() => buildNavigationTheme(scheme, colors), [scheme, colors]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  useEffect(() => {
    if (!profile || syncedFromProfile.current) return;
    syncedFromProfile.current = true;
    if (profile.theme === "light" || profile.theme === "dark") {
      setMode(profile.theme as ThemeMode);
    }
  }, [profile, setMode]);

  useEffect(() => {
    if (!profile) return;
    // The timer expiry outbox survives app termination. Flush it as soon as an
    // authenticated app instance starts and whenever connectivity returns.
    void flushPendingTimedSetCompletions();
    return NetInfo.addEventListener((network) => {
      if (network.isConnected && network.isInternetReachable !== false) {
        void flushPendingTimedSetCompletions();
      }
    });
  }, [profile]);

  return (
    <NavigationThemeProvider value={navTheme}>
      <ScreenBackground>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <SubscriptionRouteGuard>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: "none",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/signup" />
            <Stack.Screen name="onboarding/index" />
            <Stack.Screen name="paywall" />
            <Stack.Screen name="tutorial-workout" />
            <Stack.Screen name="finish-setup" />
            <Stack.Screen name="generating" />
            <Stack.Screen name="drill-timer" />
            <Stack.Screen name="drill-detail" />
            <Stack.Screen name="workout-stats" />
            <Stack.Screen name="edit-training-preference" />
            <Stack.Screen name="workout-edit-manual" />
            <Stack.Screen name="achievements" />
            <Stack.Screen name="workout-edit-ai" />
            <Stack.Screen name="coach-guide" />
            <Stack.Screen name="ai-data-processing" />
            <Stack.Screen
              name="(tabs)"
              options={{
                animation: "none",
                gestureEnabled: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </Stack>
        </SubscriptionRouteGuard>
      </ScreenBackground>
    </NavigationThemeProvider>
  );
}

function AppShell() {
  const { colors } = useThemeContext();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ConnectivityProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <RootNavigator />
          </SubscriptionProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontLoadTimedOut) return;
    const timeout = setTimeout(() => setFontLoadTimedOut(true), 1_200);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontLoadTimedOut]);

  useEffect(() => {
    // Keep the branded native launch screen briefly, then reveal the app even
    // if authentication or workout data are still finishing in the background.
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 1_200);
    return () => clearTimeout(timeout);
  }, []);

  if (!fontsLoaded && !fontLoadTimedOut) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <TourProvider
          tours={tutorialTour}
          colorScheme="auto"
          defaultCutout={{ shape: "rounded", padding: 8, radius: 16 }}
          tooltipComponent={TutorialGuidewayBubble}
          overlayTapBehavior="none"
          allowTargetInteraction
        >
          <AppShell />
        </TourProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const tutorialBubbleStyles = StyleSheet.create({
  container: { width: 310 },
  label: {
    alignSelf: "flex-start",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
    marginLeft: 12,
    zIndex: 1,
  },
  labelText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  bubble: {
    marginTop: -3,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 22,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  message: { fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
