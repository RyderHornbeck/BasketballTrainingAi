import { Card } from "@/components/Card";
import { ExerciseCard } from "@/components/ExerciseCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { actionHaptic } from "@/lib/haptics";
import { ExerciseLogInput } from "@/lib/plan";
import { sortWorkoutExercisesForDisplay } from "@/lib/workoutOrder";
import { WorkoutDayWithExercises } from "@/types/plan";
import {
  BasketballIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  FloppyDiskIcon,
  MagicWandIcon,
  PencilSimpleIcon,
  PercentIcon,
  PlusIcon,
  TargetIcon,
  TimerIcon,
} from "phosphor-react-native";
import React, { RefObject } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";

interface WorkoutDayDetailModel {
  workout: WorkoutDayWithExercises;
  shootingStats: {
    shots: number;
    makes: number;
    accuracy: number | null;
  };
  editing: boolean;
  finishing: boolean;
  completionAnimationTokens: Record<string, number>;
  exerciseOrder?: "display" | "provided";
}

interface WorkoutDayDetailActions {
  onBack: () => void;
  onToggleEditing: () => void;
  onAddWithAI: () => void;
  onAddManually: () => void;
  onDeleteExercise: (exerciseId: string, exerciseName: string | null) => void;
  onLogChange: (log: ExerciseLogInput) => void;
  onFinish: () => void;
  onExerciseExpandedChange?: (exerciseId: string, expanded: boolean) => void;
  onExercisePress?: (exerciseId: string) => void;
  onDrillsLayout?: (event: LayoutChangeEvent) => void;
}

interface WorkoutDayDetailProps {
  model: WorkoutDayDetailModel;
  actions: WorkoutDayDetailActions;
  drillsTargetRef?: RefObject<View | null>;
}

export function WorkoutDayDetail({
  model,
  actions,
  drillsTargetRef,
}: WorkoutDayDetailProps) {
  const { colors } = useTheme();
  const {
    workout,
    shootingStats,
    editing,
    finishing,
    completionAnimationTokens,
    exerciseOrder = "display",
  } = model;
  const exercises =
    exerciseOrder === "provided"
      ? workout.exercises
      : sortWorkoutExercisesForDisplay(workout.exercises);

  return (
    <View>
      <Pressable
        onPress={() => {
          actionHaptic();
          actions.onBack();
        }}
        style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.65 : 1 }]}
        hitSlop={8}
      >
        <CaretLeftIcon size={22} color={colors.accent} weight="bold" />
        <Text style={[styles.backText, { color: colors.accent }]}>Back to day overview</Text>
      </Pressable>

      <View style={styles.dayWorkoutTopRow}>
        <Text style={[styles.dayWorkoutLabel, { color: colors.textMuted }]}>
          Day {workout.day_number} Workout
        </Text>
        <Pressable
          onPress={() => {
            actionHaptic();
            actions.onToggleEditing();
          }}
          style={({ pressed }) => [
            styles.editWorkoutButton,
            {
              backgroundColor: editing ? colors.accent : colors.card,
              borderColor: colors.accent,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          {editing ? (
            <FloppyDiskIcon size={15} color="#FFFFFF" weight="bold" />
          ) : (
            <PencilSimpleIcon size={15} color={colors.accent} weight="bold" />
          )}
          <Text
            style={[
              styles.editWorkoutButtonText,
              { color: editing ? "#FFFFFF" : colors.accent },
            ]}
          >
            {editing ? "Save changes" : "Edit"}
          </Text>
        </Pressable>
      </View>
      <Card style={styles.workoutStatsCard}>
        <View style={styles.weekStat}>
          <BasketballIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Shots</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>{shootingStats.shots}</Text>
        </View>
        <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.weekStat}>
          <TargetIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Makes</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>{shootingStats.makes}</Text>
        </View>
        <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.weekStat}>
          <PercentIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Accuracy</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>
            {shootingStats.accuracy != null ? `${shootingStats.accuracy}%` : "--"}
          </Text>
        </View>
      </Card>

      {editing ? (
        <View style={styles.addWorkoutActions}>
          <Pressable
            onPress={() => {
              actionHaptic();
              actions.onAddWithAI();
            }}
            style={({ pressed }) => [
              styles.addWorkoutButton,
              styles.addWorkoutAIButton,
              { backgroundColor: colors.accentMuted, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <MagicWandIcon size={18} color={colors.accent} weight="bold" />
            <Text style={[styles.addWorkoutButtonText, { color: colors.accent }]}>Add with AI</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              actionHaptic();
              actions.onAddManually();
            }}
            style={({ pressed }) => [
              styles.addWorkoutButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <PlusIcon size={18} color={colors.text} weight="bold" />
            <Text style={[styles.addWorkoutButtonText, { color: colors.text }]}>Add manually</Text>
          </Pressable>
        </View>
      ) : null}

      <View ref={drillsTargetRef} onLayout={actions.onDrillsLayout}>
        <View style={styles.workoutHeader}>
          <Text style={[styles.workoutHeaderTitle, { color: colors.text }]}>
            {workout.exercises.length} {workout.exercises.length === 1 ? "exercise" : "exercises"}
          </Text>
          {workout.estimated_minutes ? (
            <View style={styles.workoutHeaderMetaRow}>
              <TimerIcon size={14} color={colors.textSecondary} weight="duotone" />
              <Text style={[styles.workoutHeaderMeta, { color: colors.textSecondary }]}>
                ~{workout.estimated_minutes} min workout
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.drillsLabel, { color: colors.textMuted }]}>Drills</Text>
        {exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            readOnly={false}
            editMode={editing}
            expanded={actions.onExercisePress ? false : undefined}
            completionAnimationToken={completionAnimationTokens[exercise.id]}
            onExpandedChange={(expanded) => {
              actions.onExerciseExpandedChange?.(exercise.id, expanded);
              if (expanded) actions.onExercisePress?.(exercise.id);
            }}
            onDelete={() => actions.onDeleteExercise(exercise.id, exercise.name)}
            onLogChange={actions.onLogChange}
          />
        ))}
      </View>

      {workout.completed ? (
        <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
          <CheckCircleIcon size={16} color={colors.accent} weight="fill" />
          <Text style={[styles.completedBannerText, { color: colors.accent }]}>Workout complete</Text>
        </View>
      ) : (
        <Pressable
          onPress={actions.onFinish}
          disabled={finishing}
          style={({ pressed }) => [
            styles.finishWorkoutButton,
            {
              backgroundColor: colors.accent,
              opacity: finishing || pressed ? 0.86 : 1,
              shadowColor: colors.accent,
            },
          ]}
        >
          {finishing ? (
            <Text style={styles.finishWorkoutButtonText}>Saving workout...</Text>
          ) : (
            <>
              <CheckCircleIcon size={20} color="#FFFFFF" weight="fill" />
              <Text style={styles.finishWorkoutButtonText}>Finish workout</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 16, paddingHorizontal: 2 },
  backText: { fontSize: 15, fontWeight: "700" },
  dayWorkoutTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayWorkoutLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 8, paddingHorizontal: 4 },
  editWorkoutButton: { minHeight: 32, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  editWorkoutButtonText: { fontSize: 12, fontWeight: "800" },
  workoutStatsCard: { flexDirection: "row", alignItems: "stretch", marginBottom: 18 },
  weekStat: { flex: 1, alignItems: "center", gap: 5 },
  weekStatDivider: { width: 1, marginVertical: 4 },
  weekStatLabel: { fontSize: 11, fontWeight: "700", textAlign: "center", lineHeight: 14 },
  weekStatValue: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  addWorkoutActions: { flexDirection: "row", gap: 10, marginBottom: 18 },
  addWorkoutButton: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  addWorkoutAIButton: { borderWidth: 0 },
  addWorkoutButtonText: { fontSize: 13, fontWeight: "800" },
  workoutHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 2 },
  workoutHeaderTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  workoutHeaderMeta: { fontSize: 14, fontWeight: "600" },
  workoutHeaderMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  drillsLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, marginTop: 4, paddingHorizontal: 2 },
  completedBanner: { marginTop: 12, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  completedBannerText: { fontWeight: "800", fontSize: 15 },
  finishWorkoutButton: { marginTop: 18, minHeight: 54, borderRadius: 16, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.24, shadowRadius: 10, elevation: 4 },
  finishWorkoutButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
