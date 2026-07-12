import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { TextInput } from "@/components/TextInput";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { clearOnboardingDraft, loadOnboardingDraft } from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { Link, router } from "expo-router";
import { BasketballIcon } from "phosphor-react-native";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

export default function SignupScreen() {
  const { colors } = useTheme();
  const { signUp, refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    setError(null);
    setInfo(null);

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await signUp(email.trim(), password);

      const { data } = await supabase.auth.getSession();
      const newUserId = data.session?.user.id;

      if (!newUserId) {
        setInfo("Check your email to confirm your account, then log in.");
        return;
      }

      // The user already answered every onboarding question before getting
      // here -- write those answers to their brand-new account now, then go
      // straight into plan generation instead of asking anything twice.
      const draft = await loadOnboardingDraft();
      if (draft) {
        await submitOnboardingAnswers(newUserId, draft);
        await clearOnboardingDraft();
        await refreshProfile();
        await requestPlanGeneration();
        router.replace("/generating");
      } else {
        // Shouldn't normally happen (onboarding always runs first), but
        // don't strand the user if it does.
        router.replace("/onboarding");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign up.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: "transparent" }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <BasketballIcon size={56} color={colors.accent} weight="duotone" />
          <Text style={[styles.appName, { color: colors.text }]}>Create your account</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Let&apos;s build your personalized training plan.
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="At least 6 characters"
            textContentType="oneTimeCode"
            autoComplete="off"
            passwordRules=""
          />
          <TextInput
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Re-enter your password"
            textContentType="oneTimeCode"
            autoComplete="off"
            passwordRules=""
          />

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          {info ? <Text style={[styles.info, { color: colors.success }]}>{info}</Text> : null}

          <Button title="Sign Up" onPress={handleSignup} loading={loading} style={styles.button} />
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>Already have an account?</Text>
          <Link href="/auth/login">
            <Text style={[styles.footerLink, { color: colors.accent }]}> Log in</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
  },
  brand: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    fontSize: 56,
  },
  appName: {
    fontSize: 26,
    fontWeight: "800",
    marginTop: 8,
    textAlign: "center",
  },
  tagline: {
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
  form: {
    width: "100%",
  },
  error: {
    fontSize: 13,
    marginBottom: 12,
  },
  info: {
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    marginTop: 6,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "700",
  },
});
