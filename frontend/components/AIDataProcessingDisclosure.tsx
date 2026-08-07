import { Card } from "@/components/Card";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { PRIVACY_POLICY_URL } from "@/lib/legal";
import { Linking, Pressable, StyleSheet, View } from "react-native";

export function AIDataProcessingDisclosure() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <DisclosureSection
          label="What is sent"
          detail="Basketball profile answers, workouts, performance data, spoken commands, microphone audio, or transcripts—only what you actually send."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <DisclosureSection
          label="Who receives it"
          detail="OpenAI, Anthropic, and Cartesia may receive the data needed to provide their respective AI, voice-recognition, and voice-playback services."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <DisclosureSection
          label="Why it is sent"
          detail="Generating personalized workouts, understanding voice commands, and producing coaching responses."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.assurance, { color: colors.textSecondary }]}>
          You can withdraw permission at any time from Profile &gt; Privacy.
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Text style={[styles.link, { color: colors.accent }]}>Read the Privacy Policy</Text>
        </Pressable>
      </Card>
    </View>
  );
}

function DisclosureSection({ label, detail }: { label: string; detail: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  card: {
    padding: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 13,
  },
  section: {
    gap: 3,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  detail: {
    fontSize: 13,
    lineHeight: 20,
  },
  assurance: {
    fontSize: 13,
    lineHeight: 20,
  },
  link: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
