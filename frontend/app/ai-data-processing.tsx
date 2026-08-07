import { AIDataProcessingDisclosure } from "@/components/AIDataProcessingDisclosure";
import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import {
  setAIDataConsent,
  type AIDataConsentSource,
} from "@/lib/aiDataConsent";
import { requestPlanGeneration } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeftIcon } from "phosphor-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function AIDataProcessingScreen() {
  const { colors } = useTheme();
  const { profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: string }>();
  const [savingChoice, setSavingChoice] = useState<"allow" | "deny" | null>(null);
  const source: AIDataConsentSource =
    params.source === "coach_gate" ? "coach_gate" : "settings";

  const maybeStartMissingPlan = async () => {
    if (!profile?.onboarding_completed) return;
    const { count, error } = await supabase
      .from("workout_plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id);
    if (error || (count ?? 0) > 0) return;
    void requestPlanGeneration().catch((generationError) => {
      console.warn("Unable to start plan generation after AI consent:", generationError);
    });
  };

  const saveChoice = async (allowed: boolean) => {
    if (savingChoice) return;
    setSavingChoice(allowed ? "allow" : "deny");
    try {
      await setAIDataConsent(allowed, source);
      await refreshProfile();
      if (allowed) await maybeStartMissingPlan();
      router.back();
    } catch (error) {
      Alert.alert(
        "Could not update permission",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setSavingChoice(null);
    }
  };

  return (
    <LinearGradient
      colors={["rgba(247,179,121,0.30)", colors.background, colors.background]}
      locations={[0, 0.42, 1]}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
        >
          <ArrowLeftIcon size={22} color={colors.text} weight="bold" />
        </Pressable>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: colors.text }]}>Data and Privacy</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Review how Court Coach uses data when you choose AI-powered features.
        </Text>
        <AIDataProcessingDisclosure />
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Button
          title="Not Now"
          variant="outline"
          onPress={() => void saveChoice(false)}
          loading={savingChoice === "deny"}
          disabled={savingChoice !== null}
          style={styles.button}
        />
        <Button
          title="Agree and Continue"
          onPress={() => void saveChoice(true)}
          loading={savingChoice === "allow"}
          disabled={savingChoice !== null}
          style={styles.button}
        />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerSpacer: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  title: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 16,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 26,
    gap: 10,
  },
  button: {
    width: "100%",
  },
});
