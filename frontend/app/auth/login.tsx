import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { TextInput } from "@/components/TextInput";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
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

export default function LoginScreen() {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log in.");
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
          <Text style={[styles.appName, { color: colors.text }]}>HoopPlan</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Your personalized basketball training coach.
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
            placeholder="••••••••"
            textContentType="password"
          />

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <Button title="Log In" onPress={handleLogin} loading={loading} style={styles.button} />

          <Link href="/auth/forgot-password" style={styles.linkWrapper}>
            <Text style={[styles.link, { color: colors.textSecondary }]}>Forgot password?</Text>
          </Link>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>Don&apos;t have an account?</Text>
          <Link href="/onboarding">
            <Text style={[styles.footerLink, { color: colors.accent }]}> Get started</Text>
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
    fontSize: 30,
    fontWeight: "800",
    marginTop: 8,
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
  button: {
    marginTop: 6,
  },
  linkWrapper: {
    marginTop: 16,
    alignSelf: "center",
  },
  link: {
    fontSize: 14,
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
