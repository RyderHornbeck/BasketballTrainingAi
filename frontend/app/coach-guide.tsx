import { Card } from "@/components/Card";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const GUIDE_SECTIONS = [
  {
    icon: "basketball-outline" as const,
    title: "Log shots and sets",
    description:
      "Court Coach saves results to the current set unless you name another drill or set.",
    examples: [
      '"I made 10 shots."',
      '"I made 8 out of 10 on set two."',
      '"Mark set two complete."',
      '"Reopen set one."',
    ],
  },
  {
    icon: "checkmark-done-outline" as const,
    title: "Complete or skip drills",
    description:
      "Completing saves the drill as done. Skipping moves you forward without changing its results.",
    examples: [
      '"I finished this drill."',
      '"Reopen this drill."',
      '"Skip this drill and go to the next one."',
    ],
  },
  {
    icon: "navigate-outline" as const,
    title: "Move around your workout",
    description:
      "Ask about your position or move to any drill by its name or place in the workout.",
    examples: [
      '"What’s next?"',
      '"Go to the form shooting drill."',
      '"Go back to the previous drill."',
      '"How many drills do I have left?"',
    ],
  },
  {
    icon: "timer-outline" as const,
    title: "Control the timer",
    description:
      "For timed drills, Court Coach can use the set’s planned duration or a duration you choose.",
    examples: [
      '"Start the timer for this set."',
      '"Start a two-minute timer."',
      '"Pause the timer."',
      '"Resume the timer."',
      '"Stop the timer."',
    ],
  },
  {
    icon: "create-outline" as const,
    title: "Change the workout",
    description:
      "You can add or remove drills, change the remaining workout time, and save notes.",
    examples: [
      '"Add a cone dribbling drill."',
      '"Remove this drill."',
      '"Add 10 minutes to my workout."',
      '"Save a note that my left hand felt weak."',
    ],
  },
  {
    icon: "help-circle-outline" as const,
    title: "Ask your coach",
    description:
      "Ask about targets, results, technique, progress, or any drill in today’s workout.",
    examples: [
      '"How many makes do I have on this drill?"',
      '"What is the target for set three?"',
      '"How do I keep my elbow aligned?"',
    ],
  },
];

export default function CoachGuideScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>How to use Court Coach</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          Open Coach and speak naturally. It listens while the Coach screen is open and can answer
          questions or update your current workout.
        </Text>

        <Card style={styles.tipCard} variant="alt" elevated={false}>
          <View style={styles.tipRow}>
            <Ionicons name="sparkles" size={22} color={colors.accent} />
            <Text style={[styles.tipText, { color: colors.text }]}>
              For the most accurate result, name the drill or set and wait for the coach to confirm
              what it saved.
            </Text>
          </View>
        </Card>

        {GUIDE_SECTIONS.map((section) => (
          <Card key={section.title} style={styles.guideCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconCircle, { backgroundColor: colors.accentMuted }]}>
                <Ionicons name={section.icon} size={22} color={colors.accent} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
            </View>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {section.description}
            </Text>
            <View style={styles.examples}>
              {section.examples.map((example) => (
                <View key={example} style={styles.exampleRow}>
                  <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.exampleText, { color: colors.text }]}>{example}</Text>
                </View>
              ))}
            </View>
          </Card>
        ))}

        <Text style={[styles.footer, { color: colors.textMuted }]}>
          Court Coach can make mistakes. Check saved results before ending your workout.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "transparent",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 19,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 42,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  intro: {
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 16,
  },
  tipCard: {
    marginBottom: 16,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  guideCard: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 12,
  },
  examples: {
    gap: 9,
  },
  exampleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  exampleText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
    marginTop: 4,
  },
});
