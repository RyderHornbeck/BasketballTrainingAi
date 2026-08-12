import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { isLikelyNetworkError, reportNetworkFailure } from "@/lib/connectivity";
import { routeAfterSocialAuth } from "@/lib/postAuth";
import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import { Link, router } from "expo-router";
import { ArrowLeftIcon } from "phosphor-react-native";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

type Provider = "google" | "apple";

function authErrorMessage(error: unknown, provider: Provider): string {
  const providerName = provider === "google" ? "Google" : "Apple";
  const fallback = `We couldn’t sign you in with ${providerName}. Please try again.`;
  if (isLikelyNetworkError(error)) {
    return "We couldn’t connect. Check your internet connection and try again.";
  }
  if (!(error instanceof Error)) return fallback;

  const message = error.message.toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "").toLowerCase()
      : "";
  if (message.includes("database error saving new user")) {
    return "Court Coach couldn’t finish creating your account. Please try again. If you recently deleted this account, wait 24 hours before recreating it.";
  }
  if (message.includes("not available on this device")) {
    return `${providerName} sign-in is not available on this device.`;
  }
  if (message.includes("rate limit") || message.includes("too many")) {
    return "There have been too many sign-in attempts. Please try again later.";
  }
  if (
    code.includes("bad_oauth") ||
    code.includes("validation") ||
    message.includes("audience") ||
    message.includes("identity token") ||
    message.includes("nonce")
  ) {
    return `We couldn’t verify your ${providerName} sign-in. Please try again.`;
  }
  if (message.includes("signup") && message.includes("disabled")) {
    return "New account creation is temporarily unavailable.";
  }

  return fallback;
}

export function SocialAuthScreen({ mode }: { mode: "login" | "signup" }) {
  const { colors } = useTheme();
  const { signInWithApple, signInWithGoogle, refreshProfile } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authInFlightRef = useRef(false);

  const authenticate = async (provider: Provider) => {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    setError(null);
    setLoadingProvider(provider);
    try {
      const user =
        provider === "google" ? await signInWithGoogle() : await signInWithApple();
      if (!user) return;
      await routeAfterSocialAuth(user.id, refreshProfile);
    } catch (authError) {
      if (isLikelyNetworkError(authError)) reportNetworkFailure(`${provider}-sign-in`);
      console.error(`${provider} sign-in failed`, {
        code:
          typeof authError === "object" && authError !== null && "code" in authError
            ? String((authError as { code?: unknown }).code ?? "")
            : "",
        message: authError instanceof Error ? authError.message : String(authError),
      });
      setError(authErrorMessage(authError, provider));
    } finally {
      authInFlightRef.current = false;
      setLoadingProvider(null);
    }
  };

  const busy = loadingProvider !== null;

  return (
    <LinearGradient
      colors={["rgba(247,179,121,0.30)", colors.background, colors.background]}
      locations={[0, 0.42, 1]}
      style={styles.flex}
    >
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mode === "signup" ? "Back to onboarding" : "Back to Get Started"}
        onPress={() => {
          if (mode === "login") {
            router.replace("/welcome");
            return;
          }
          if (mode === "signup") {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/onboarding");
            }
          }
        }}
        hitSlop={10}
        style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <ArrowLeftIcon size={20} color={colors.text} weight="bold" />
      </Pressable>
      <View style={styles.brand}>
        <Image
          accessibilityLabel="Court Coach AI"
          source={require("../assets/images/AppLogo.png")}
          resizeMode="contain"
          style={styles.appLogo}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Continue securely with your Google or Apple account.
        </Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.googleButtonWrapper}>
          <SocialButton
            label="Continue with Google"
            icon={<GoogleMark />}
            loading={loadingProvider === "google"}
            disabled={busy}
            onPress={() => void authenticate("google")}
            backgroundColor={colors.card}
            borderColor={colors.border}
            textColor={colors.text}
          />
        </View>

        {Platform.OS === "ios" ? (
          <View style={[styles.appleButtonWrapper, { opacity: busy ? 0.55 : 1 }]}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                colors.text === "#FFFFFF"
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={18}
              style={styles.appleButton}
              onPress={() => {
                if (!busy) void authenticate("apple");
              }}
            />
            {loadingProvider === "apple" ? (
              <View pointerEvents="none" style={styles.appleLoading}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {mode === "login" ? "New to Court Coach?" : "Already use Court Coach?"}
        </Text>
        <Link href={mode === "login" ? "/onboarding" : "/auth/login"}>
          <Text style={[styles.footerLink, { color: colors.accent }]}>
            {mode === "login" ? " Get started" : " Log in"}
          </Text>
        </Link>
      </View>
    </ScrollView>
    </LinearGradient>
  );
}

function SocialButton({
  label,
  icon,
  loading,
  disabled,
  onPress,
  backgroundColor,
  borderColor,
  textColor,
}: {
  label: string;
  icon: React.ReactNode;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialButton,
        {
          backgroundColor,
          borderColor,
          opacity: disabled && !loading ? 0.55 : pressed ? 0.84 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : icon}
      <Text style={[styles.socialButtonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

function GoogleMark() {
  return (
    <Svg width={22} height={22} viewBox="0 0 18 18">
      <Path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.483h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.909c1.703-1.568 2.683-3.876 2.683-6.617Z" />
      <Path fill="#4285F4" d="M9 18c2.43 0 4.467-.806 5.956-2.178l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.037-3.71H.956v2.332A9 9 0 0 0 9 18Z" />
      <Path fill="#FBBC05" d="M3.963 10.713A5.41 5.41 0 0 1 3.681 9c0-.594.102-1.172.282-1.713V4.955H.956A9 9 0 0 0 0 9c0 1.452.348 2.827.956 4.045l3.007-2.332Z" />
      <Path fill="#34A853" d="M9 3.578c1.322 0 2.508.455 3.441 1.348l2.581-2.581C13.463.891 11.425 0 9 0A9 9 0 0 0 .956 4.955l3.007 2.332C4.672 5.162 6.656 3.578 9 3.578Z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  backButton: {
    position: "absolute",
    top: 40,
    left: 20,
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 21,
  },
  brand: {
    alignItems: "center",
    marginBottom: 40,
  },
  appLogo: {
    width: 56,
    height: 56,
  },
  title: {
    marginTop: 10,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  actions: {
    gap: 14,
  },
  googleButtonWrapper: {
    borderRadius: 18,
    overflow: "hidden",
  },
  socialButton: {
    height: 54,
    borderWidth: 1.5,
    borderRadius: 18,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  appleButtonWrapper: {
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
  },
  appleButton: {
    width: "100%",
    height: 54,
  },
  appleLoading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  footer: {
    marginTop: 32,
    flexDirection: "row",
    justifyContent: "center",
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "700",
  },
});
