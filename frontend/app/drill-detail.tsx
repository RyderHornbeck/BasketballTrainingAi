import { DrillPreview } from "@/components/DrillPreview";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { getExerciseCatalogItem } from "@/lib/plan";
import { ExerciseVideoClip } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeftIcon } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DrillDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { clipId } = useLocalSearchParams<{ clipId?: string }>();
  const [clip, setClip] = useState<ExerciseVideoClip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clipId) {
      setLoading(false);
      return;
    }
    void getExerciseCatalogItem(clipId)
      .then(setClip)
      .finally(() => setLoading(false));
  }, [clipId]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ArrowLeftIcon size={24} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Drill details</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.accent} />
      ) : clip ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: colors.text }]}>{clip.exercise_name}</Text>
          <Text style={[styles.category, { color: colors.accent }]}>
            {clip.category.replace(/_/g, " ")}
          </Text>
          <DrillPreview clip={clip} />
        </ScrollView>
      ) : (
        <Text style={[styles.notFound, { color: colors.textSecondary }]}>Drill not found.</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 54,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800" },
  headerSpacer: { width: 24 },
  loader: { marginTop: 50 },
  scroll: { padding: 20, paddingBottom: 50 },
  title: { fontSize: 25, fontWeight: "800", lineHeight: 32 },
  category: {
    marginTop: 5,
    marginBottom: 20,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  notFound: { marginTop: 50, textAlign: "center", fontSize: 15 },
});
