import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { TextInput } from "@/components/TextInput";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setError(null);
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: "transparent" }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>Reset your password</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        We&apos;ll email you a link to reset your password.
      </Text>

      <View style={styles.form}>
        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
        />

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        {sent ? (
          <Text style={[styles.info, { color: colors.success }]}>
            Check your inbox for a password reset link.
          </Text>
        ) : null}

        <Button title="Send Reset Link" onPress={handleSend} loading={loading} style={styles.button} />
        <Button title="Back to Login" variant="outline" onPress={() => router.replace("/auth/login")} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 100,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 32,
  },
  form: {
    gap: 12,
  },
  error: {
    fontSize: 13,
  },
  info: {
    fontSize: 13,
  },
  button: {
    marginTop: 6,
  },
});
