import { Card } from "@/components/Card";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal";
import { Linking, Pressable, StyleSheet, View } from "react-native";

export function AIDataProcessingDisclosure({
  privacyAccepted = false,
  termsAccepted = false,
  onPrivacyToggle = () => undefined,
  onTermsToggle = () => undefined,
}: {
  privacyAccepted?: boolean;
  termsAccepted?: boolean;
  onPrivacyToggle?: () => void;
  onTermsToggle?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Privacy Policy</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Please review and accept our policies</Text>
      <ConsentRow accepted={privacyAccepted} onPress={onPrivacyToggle} link="View Privacy Policy" url={PRIVACY_POLICY_URL} label="I have read and accept the Privacy Policy." />
      <ConsentRow accepted={termsAccepted} onPress={onTermsToggle} link="View Terms of Service" url={TERMS_OF_SERVICE_URL} label="I have read and accept the Terms of Service." />
      <Text style={[styles.assurance, { color: colors.textSecondary }]}>By continuing, you agree to allow Court Coach AI to process your workout audio for AI coaching and store your performance data securely.</Text>
    </View>
  );
}

function ConsentRow({ accepted, onPress, label, link, url }: { accepted: boolean; onPress: () => void; label: string; link: string; url: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.row, { borderColor: accepted ? colors.accent : "transparent" }]}>
      <View style={[styles.circle, { borderColor: colors.accent, backgroundColor: accepted ? colors.accent : colors.card }]}>
        {accepted ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <View style={styles.copy}><Text style={[styles.detail, { color: colors.text }]}>{label}</Text><Pressable onPress={() => void Linking.openURL(url)}><Text style={[styles.link, { color: colors.accent }]}>{link}</Text></Pressable></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: "800", marginBottom: 4 },
  subtitle: { fontSize: 15, marginBottom: 18 },
  row: { flexDirection: "row", padding: 14, borderWidth: 1, borderRadius: 14, marginBottom: 10, gap: 12 },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  check: { color: "#fff", fontWeight: "900" },
  copy: { flex: 1, gap: 4 },
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
