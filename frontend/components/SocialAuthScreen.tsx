import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { routeAfterSocialAuth } from "@/lib/postAuth";
import * as AppleAuthentication from "expo-apple-authentication";
import { Link } from "expo-router";
import { BasketballIcon, GoogleLogoIcon } from "phosphor-react-native";
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

type Provider = "google" | "apple";

export function SocialAuthScreen({ mode }: { mode: "login" | "signup" }) {
  const { colors } = useTheme();
  const { signInWithApple, signInWithGoogle, refreshProfile } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authenticate = async (provider: Provider) => {
    setError(null);
    setLoadingProvider(provider);
    try {
      const user =
        provider === "google" ? await signInWithGoogle() : await signInWithApple();
      if (!user) return;
      await routeAfterSocialAuth(user.id, refreshProfile);
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : `Unable to continue with ${provider === "google" ? "Google" : "Apple"}.`;
      setError(message);
    } finally {
      setLoadingProvider(null);
    }
  };

  const busy = loadingProvider !== null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.brand}>
        <BasketballIcon size={56} color={colors.accent} weight="duotone" />
        <Text style={[styles.title, { color: colors.text }]}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Continue securely with your Google or Apple account.
        </Text>
      </View>

      <View style={styles.actions}>
        <SocialButton
          label="Continue with Google"
          icon={<GoogleLogoIcon size={22} color={colors.text} weight="bold" />}
          loading={loadingProvider === "google"}
          disabled={busy}
          onPress={() => void authenticate("google")}
          backgroundColor={colors.card}
          borderColor={colors.border}
          textColor={colors.text}
        />

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

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  brand: {
    alignItems: "center",
    marginBottom: 40,
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
