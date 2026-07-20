import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { reportNetworkFailure } from "@/lib/connectivity";
import {
  addCatalogExerciseToWorkout,
  getExerciseCatalog,
  getWorkoutDayWithExercises,
} from "@/lib/plan";
import { classifyShotZones } from "@/lib/shotMap";
import { ExerciseVideoClip } from "@/types/database";
import { ArrowLeftIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon } from "phosphor-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ZONE_LABELS: Record<string, string> = {
  left_corner_three: "left corner three",
  right_corner_three: "right corner three",
  left_wing_three: "left wing three",
  right_wing_three: "right wing three",
  top_of_key_three: "top of key three",
  left_midrange: "left mid-range",
  right_midrange: "right mid-range",
  center_midrange: "center mid-range",
  left_short_range: "left short range",
  right_short_range: "right short range",
  paint: "paint",
  rim: "rim",
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b3(?:s|'s)?\b/g, " three ")
    .replace(/\bthree[- ]pointer(?:s)?\b/g, " three ")
    .replace(/mid[- ]range/g, " midrange ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchableText(clip: ExerciseVideoClip): string {
  const zones = classifyShotZones(
    clip.exercise_name,
    clip.category,
    clip.description ?? clip.coaching_notes ?? ""
  ).map((zone) => ZONE_LABELS[zone] ?? zone);
  return normalizeSearchText([
    clip.exercise_name,
    clip.category,
    clip.description,
    clip.coaching_notes,
    clip.difficulty_level,
    clip.source_section,
    ...(clip.goals ?? []),
    ...(clip.weaknesses ?? []),
    ...zones,
  ]
    .filter(Boolean)
    .join(" "));
}

function searchScore(clip: ExerciseVideoClip, query: string): number {
  if (!query.trim()) return 1;
  const name = normalizeSearchText(clip.exercise_name);
  const text = searchableText(clip);
  const tokens = normalizeSearchText(query).split(/\s+/);
  if (!tokens.every((token) => text.includes(token))) return 0;
  return tokens.reduce((score, token) => {
    if (name === token) return score + 30;
    if (name.startsWith(token)) return score + 15;
    if (name.includes(token)) return score + 8;
    return score + 2;
  }, 0);
}

export default function WorkoutEditManualScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId?: string }>();
  const [catalog, setCatalog] = useState<ExerciseVideoClip[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!dayId) return;
    void Promise.all([getExerciseCatalog(), getWorkoutDayWithExercises(dayId)])
      .then(([clips, workout]) => {
        setCatalog(clips);
        setAddedIds(
          new Set(
            (workout?.exercises ?? [])
              .map((exercise) => exercise.video_clip_id)
              .filter((id): id is string => Boolean(id))
          )
        );
      })
      .finally(() => setLoading(false));
  }, [dayId]);

  const results = useMemo(
    () =>
      catalog
        .map((clip) => ({ clip, score: searchScore(clip, query) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || a.clip.exercise_name.localeCompare(b.clip.exercise_name))
        .map((result) => result.clip),
    [catalog, query]
  );

  const addExercise = async (clip: ExerciseVideoClip) => {
    if (!dayId || addedIds.has(clip.id) || addingId) return;
    setAddingId(clip.id);
    try {
      await addCatalogExerciseToWorkout(dayId, clip);
      setAddedIds((current) => new Set(current).add(clip.id));
    } catch (error) {
      reportNetworkFailure("add-exercise");
      Alert.alert(
        "Could not add exercise",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setAddingId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ArrowLeftIcon size={24} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Add exercises</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MagnifyingGlassIcon size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, instructions, category, or court spot"
          placeholderTextColor={colors.textMuted}
          style={[styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
        />
      </View>
      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.accent} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(clip) => clip.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const added = addedIds.has(item.id);
            const zones = classifyShotZones(
              item.exercise_name,
              item.category,
              item.description ?? item.coaching_notes ?? ""
            ).map((zone) => ZONE_LABELS[zone] ?? zone);
            return (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/drill-detail",
                      params: { clipId: item.id },
                    })
                  }
                  style={styles.resultCopy}
                >
                  <Text style={[styles.resultName, { color: colors.text }]}>{item.exercise_name}</Text>
                  <Text style={[styles.resultMeta, { color: colors.accent }]}>
                    {item.category.replace(/_/g, " ")}
                    {zones.length ? ` · ${zones.join(", ")}` : ""}
                  </Text>
                  {item.description ? (
                    <Text numberOfLines={3} style={[styles.resultDescription, { color: colors.textSecondary }]}>
                      {item.description}
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable
                  disabled={added || addingId != null}
                  onPress={() => void addExercise(item)}
                  style={[
                    styles.addButton,
                    { backgroundColor: added ? colors.accentMuted : colors.accent },
                  ]}
                >
                  {addingId === item.id ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : added ? (
                    <CheckIcon size={18} color={colors.accent} weight="bold" />
                  ) : (
                    <PlusIcon size={18} color="#FFFFFF" weight="bold" />
                  )}
                </Pressable>
              </View>
            );
          }}
        />
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
  title: { flex: 1, textAlign: "center", fontSize: 19, fontWeight: "800" },
  headerSpacer: { width: 24 },
  searchBox: {
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 10,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 12 },
  loader: { marginTop: 40 },
  list: { padding: 18, paddingBottom: 50, gap: 10 },
  resultCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  resultCopy: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: "800" },
  resultMeta: { marginTop: 3, fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  resultDescription: { marginTop: 7, fontSize: 12, lineHeight: 17 },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
