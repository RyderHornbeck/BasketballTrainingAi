import { Card } from "@/components/Card";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { PRIVACY_POLICY_URL } from "@/lib/legal";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { ShieldCheckIcon } from "phosphor-react-native";

const DATA_ITEMS = [
  "Live microphone audio while the voice coach is open",
  "Transcribed speech, workout commands, and text you enter",
  "Your current workout, drills, timers, shooting results, and exercise notes",
  "Training goals, skill level, preferences, and other information you choose to provide",
];

export function AIDataProcessingDisclosure() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentMuted }]}>
        <ShieldCheckIcon size={34} color={colors.accent} weight="fill" />
      </View>

      <Card style={styles.card}>
        <Text style={[styles.heading, { color: colors.text }]}>Information that may be sent</Text>
        <View style={styles.list}>
          {DATA_ITEMS.map((item) => (
            <View key={item} style={styles.listRow}>
              <View style={[styles.bullet, { backgroundColor: colors.accent }]} />
              <Text style={[styles.listText, { color: colors.textSecondary }]}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.heading, { color: colors.text }]}>Who processes it</Text>
        <ProviderRow
          name="Cartesia"
          detail="Receives live coach audio for speech recognition and coaching-response text for spoken playback."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <ProviderRow
          name="Anthropic"
          detail="Receives transcripts, workout state, and coaching preferences to generate live coaching responses and actions."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <ProviderRow
          name="OpenAI"
          detail="Receives workout goals, preferences, workout state, notes, and edit requests when AI plan or workout-editing features use it."
        />
      </Card>

      <Text style={[styles.assurance, { color: colors.textSecondary }]}>
        Court Coach will not send this information to these AI providers unless you allow AI
        processing. You can withdraw permission at any time from Profile &gt; Privacy.
      </Text>

      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        <Text style={[styles.link, { color: colors.accent }]}>Read the Privacy Policy</Text>
      </Pressable>
    </View>
  );
}

function ProviderRow({ name, detail }: { name: string; detail: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.provider}>
      <Text style={[styles.providerName, { color: colors.text }]}>{name}</Text>
      <Text style={[styles.providerDetail, { color: colors.textSecondary }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingBottom: 8,
  },
  iconWrap: {
    alignSelf: "center",
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    padding: 18,
  },
  heading: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  list: {
    gap: 11,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 7,
  },
  listText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 13,
  },
  provider: {
    gap: 3,
  },
  providerName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  providerDetail: {
    fontSize: 12,
    lineHeight: 18,
  },
  assurance: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  link: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
