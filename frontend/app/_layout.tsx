import { ScreenBackground } from "@/components/ScreenBackground";
import { ConnectivityProvider } from "@/components/NoConnectionBanner";
import { ThemeMode, ThemeProvider, useThemeContext } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { buildNavigationTheme } from "@/lib/navigationTheme";
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

  return (
    <NavigationThemeProvider value={navTheme}>
      <ScreenBackground>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: "default",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/signup" />
          <Stack.Screen name="onboarding/index" />
          <Stack.Screen name="generating" />
          <Stack.Screen name="drill-timer" />
          <Stack.Screen name="drill-detail" />
          <Stack.Screen name="workout-edit-manual" />
          <Stack.Screen name="achievements" />
          <Stack.Screen name="workout-edit-ai" />
          <Stack.Screen name="coach-guide" />
          <Stack.Screen
            name="(tabs)"
            options={{
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </Stack>
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
          <RootNavigator />
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
    const timeout = setTimeout(() => setFontLoadTimedOut(true), 8_000);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontLoadTimedOut]);

  useEffect(() => {
    // Normal startup hides the splash from app/index only after auth and plan
    // routing resolve. This fallback prevents a restored deep link or an
    // unexpected bootstrap failure from holding the native splash forever.
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 12_000);
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
