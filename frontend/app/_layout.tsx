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
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

SplashScreen.preventAutoHideAsync().catch(() => {});

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
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
