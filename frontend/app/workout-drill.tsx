import { ExerciseCard } from "@/components/ExerciseCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  appendExerciseSet,
  getWorkoutDayWithExercises,
  removeExerciseSet,
  saveExerciseLog,
} from "@/lib/plan";
import {
  aggregateSetLogs,
  buildSetPlan,
  decodeExerciseLogMeta,
  encodeExerciseLogMeta,
  hydrateSetLogs,
} from "@/lib/exerciseSetLogs";
import { getCachedWorkoutDrill, setCachedWorkoutDrill } from "@/lib/workoutDrillCache";
import { WorkoutExerciseWithClip } from "@/types/plan";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeftIcon, DotsThreeIcon } from "phosphor-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import ContextMenu, { type ContextMenuAction } from "react-native-context-menu-view";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WorkoutDrillScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { dayId, exerciseId } = useLocalSearchParams<{ dayId?: string; exerciseId?: string }>();
  const cachedExercise = getCachedWorkoutDrill(dayId, exerciseId);
  const [exercise, setExercise] = useState<WorkoutExerciseWithClip | null>(cachedExercise);
  const [loading, setLoading] = useState(!cachedExercise);
  const [completionOverride, setCompletionOverride] = useState<boolean | null>(null);
  const activeExercise = exercise ?? cachedExercise;

  const load = useCallback(async () => {
    if (!dayId || !exerciseId) return;
    setLoading(true);
    try {
      const detail = await getWorkoutDayWithExercises(dayId);
      const refreshedExercise = detail?.exercises.find((item) => item.id === exerciseId) ?? null;
      setExercise(refreshedExercise);
      setCompletionOverride(null);
      if (refreshedExercise) setCachedWorkoutDrill(dayId, refreshedExercise);
    } finally {
      setLoading(false);
    }
  }, [dayId, exerciseId]);

  useEffect(() => {
    if (!cachedExercise) void load();
  }, [cachedExercise, load]);
  const derivedCompleted = useMemo(() => {
    if (!activeExercise) return false;
    if (activeExercise.log_type === "difficulty_rating") {
      return Boolean(activeExercise.log?.completed);
    }
    const plan = buildSetPlan(activeExercise);
    const logs = hydrateSetLogs(
      plan,
      decodeExerciseLogMeta(activeExercise.log?.notes ?? null),
      activeExercise.log ?? undefined,
    );
    return aggregateSetLogs(logs, plan).completed;
  }, [activeExercise]);
  const completed = completionOverride ?? derivedCompleted;
  const deleteSet = (setNumber: number) => {
    if (!dayId || !activeExercise) return;
    const priorExercise = activeExercise;
    const priorCount = Math.max(1, Number.parseInt(priorExercise.sets ?? "1", 10) || 1);
    if (priorCount <= 1) return;
    const existingSetLogs = hydrateSetLogs(
      buildSetPlan(priorExercise),
      decodeExerciseLogMeta(priorExercise.log?.notes ?? null),
      priorExercise.log ?? undefined,
    );
    const remainingSetLogs = existingSetLogs
      .filter((set) => set.set_number !== setNumber)
      .map((set, index) => ({ ...set, set_number: index + 1 }));
    const updatedExercise = {
      ...priorExercise,
      sets: String(priorCount - 1),
      set_side_labels: priorExercise.set_side_labels
        ? priorExercise.set_side_labels.filter((_, index) => index !== setNumber - 1)
        : null,
      log: priorExercise.log
        ? {
            ...priorExercise.log,
            notes: encodeExerciseLogMeta({
              ...decodeExerciseLogMeta(priorExercise.log.notes),
              set_logs: remainingSetLogs,
            }),
          }
        : null,
    };
    setExercise(updatedExercise);
    setCachedWorkoutDrill(dayId, updatedExercise);
    void removeExerciseSet(dayId, priorExercise.id, setNumber)
      .catch((error) => {
        setExercise(priorExercise);
        setCachedWorkoutDrill(dayId, priorExercise);
        Alert.alert("Could not delete set", error instanceof Error ? error.message : "Please try again.");
      });
  };
  const content = loading && !activeExercise ? (
    <ActivityIndicator style={styles.loader} color={colors.accent} />
  ) : activeExercise && dayId ? (
    <ExerciseCard
      exercise={activeExercise}
      expanded
      editMode
      pageMode
      headerAction={
        <SetActionsMenu
          setCount={Math.max(1, Number.parseInt(activeExercise.sets ?? "1", 10) || 1)}
          onDeleteSet={deleteSet}
        />
      }
      onLogChange={(log) => {
        // Update the shared preload cache before the network request. Returning
        // to this drill therefore can never reopen the old set count/results.
        const now = new Date().toISOString();
        const optimisticExercise: WorkoutExerciseWithClip = {
          ...activeExercise,
          log: {
            id: activeExercise.log?.id ?? `optimistic-${activeExercise.id}`,
            exercise_id: activeExercise.id,
            day_id: dayId,
            user_id: activeExercise.log?.user_id ?? "",
            completed: log.completed,
            makes: log.makes ?? null,
            attempts: log.attempts ?? null,
            minutes_completed: log.minutes_completed ?? null,
            difficulty: log.difficulty ?? null,
            notes: log.notes ?? null,
            created_at: activeExercise.log?.created_at ?? now,
            updated_at: now,
          },
        };
        setExercise(optimisticExercise);
        setCompletionOverride(log.completed);
        setCachedWorkoutDrill(dayId, optimisticExercise);
        void saveExerciseLog(dayId, log)
          .then((savedLog) => setExercise((current) => {
            if (!current) return current;
            const updated = { ...current, log: savedLog };
            setCachedWorkoutDrill(dayId, updated);
            return updated;
          }))
          .catch((error) =>
            Alert.alert("Could not save drill", error instanceof Error ? error.message : "Please try again.")
          );
      }}
      onAddSet={() => {
        const priorExercise = activeExercise;
        const priorCount = Math.max(1, Number.parseInt(priorExercise.sets ?? "1", 10) || 1);
        const nextCount = priorCount + 1;
        const nextSides = priorExercise.set_side_labels?.length
          ? [
              ...priorExercise.set_side_labels,
              nextCount % 2 === 1 ? "Right side" : "Left side",
            ]
          : null;
        // Add the row and menu action instantly; the database write follows in
        // the background and restores the server state if it fails.
        const updatedExercise = { ...priorExercise, sets: String(nextCount), set_side_labels: nextSides };
        setExercise(updatedExercise);
        setCompletionOverride(false);
        setCachedWorkoutDrill(dayId, updatedExercise);
        void appendExerciseSet(dayId, priorExercise.id).catch((error) => {
          setExercise(priorExercise);
          setCachedWorkoutDrill(dayId, priorExercise);
          Alert.alert("Could not add set", error instanceof Error ? error.message : "Please try again.");
        });
      }}
    />
  ) : (
    <Text style={[styles.notFound, { color: colors.textSecondary }]}>Drill not found.</Text>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {completed ? (
        <LinearGradient colors={["rgba(255,122,26,0.46)", colors.background]} style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ArrowLeftIcon size={23} color={colors.text} weight="bold" />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>{content}</ScrollView>
    </SafeAreaView>
  );
}

function SetActionsMenu({
  setCount,
  onDeleteSet,
}: {
  setCount: number;
  onDeleteSet: (setNumber: number) => void;
}) {
  const actions: ContextMenuAction[] = Array.from({ length: setCount }, (_, index) => ({
    title: `Delete set ${index + 1}`,
    destructive: true,
    systemIcon: "trash",
  }));
  return (
    <ContextMenu
      title="Set actions"
      actions={actions}
      dropdownMenuMode
      onPress={(event) => onDeleteSet(event.nativeEvent.index + 1)}
      style={styles.menuButton}
    >
      <DotsThreeIcon size={24} color="#6B7280" weight="bold" />
    </ContextMenu>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 52, justifyContent: "center", paddingHorizontal: 18 },
  back: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "700" },
  scroll: { padding: 18, paddingBottom: 50 },
  menuButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  loader: { marginTop: 52 },
  notFound: { marginTop: 52, textAlign: "center", fontSize: 15 },
});
