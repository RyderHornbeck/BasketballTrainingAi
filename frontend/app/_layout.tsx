import { ScreenBackground } from "@/components/ScreenBackground";
import { ThemeMode, ThemeProvider, useThemeContext } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
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
import React, { useEffect, useMemo, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  usePushNotifications();
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
    if (profile.theme === "light" || profile.theme === "dark" || profile.theme === "system") {
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
          <Stack.Screen name="auth/forgot-password" />
          <Stack.Screen name="onboarding/index" />
          <Stack.Screen name="generating" />
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
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
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

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
