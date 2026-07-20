import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { Link, router } from "expo-router";
import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: "transparent" }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Image
            accessibilityLabel="Court Coach AI"
            source={require("../assets/images/AppLogo.png")}
            resizeMode="contain"
            style={styles.appLogo}
          />
          <Text style={[styles.appName, { color: colors.text }]}>Court Coach</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Personalized basketball training plans, built for your game.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            title="Get Started"
            onPress={() => router.push("/onboarding")}
            style={styles.button}
          />
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Already have an account?
            </Text>
            <Link href="/auth/login">
              <Text style={[styles.footerLink, { color: colors.accent }]}> Log in</Text>
            </Link>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "space-between",
    padding: 24,
    paddingBottom: 32,
  },
  brand: {
    alignItems: "center",
    marginTop: "30%",
  },
  appLogo: {
    width: 72,
    height: 72,
  },
  appName: {
    fontSize: 34,
    fontWeight: "800",
    marginTop: 12,
  },
  tagline: {
    fontSize: 16,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  actions: {
    width: "100%",
  },
  button: {
    width: "100%",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "700",
  },
});
