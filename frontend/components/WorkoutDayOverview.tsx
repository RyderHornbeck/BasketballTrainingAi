import { Card } from "@/components/Card";
import { ProgressRing } from "@/components/ProgressRing";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { getPerformanceColor } from "@/lib/dayPerformance";
import {
  BasketballIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  PercentIcon,
  PlayCircleIcon,
} from "phosphor-react-native";
import React, { RefObject } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";

export interface WorkoutDayOverviewModel {
  dayNumber: number;
  isPastOrCompleted: boolean;
  completed: boolean;
  exerciseStats: {
    completed: number;
    total: number;
    progress: number;
  };
  performance: {
    score: number;
    hasData: boolean;
  };
  weeklyStats: {
    shots: number;
    accuracy: number | null;
    averagePerformance: number | null;
  };
}

export interface WorkoutDayOverviewActions {
  onStartWorkout: () => void;
  onViewWorkoutStats?: () => void;
  onStartWorkoutLayout?: (event: LayoutChangeEvent) => void;
}

interface WorkoutDayOverviewProps {
  model: WorkoutDayOverviewModel;
  actions: WorkoutDayOverviewActions;
  startWorkoutTargetRef?: RefObject<View | null>;
}

export function WorkoutDayOverview({
  model,
  actions,
  startWorkoutTargetRef,
}: WorkoutDayOverviewProps) {
  const { colors } = useTheme();
  const performanceColor = getPerformanceColor(model.performance.score, colors);

  return (
    <View>
      <Text style={[styles.dayLabel, { color: colors.textSecondary }]}>
        Day {model.dayNumber}
        {model.isPastOrCompleted ? " · Past workout" : ""}
      </Text>
      <View style={styles.statsSquareRow}>
        <Card style={styles.statSquare}>
          <View style={styles.statSquareContent}>
            <ProgressRing
              progress={model.exerciseStats.progress}
              completed={model.exerciseStats.completed}
              total={model.exerciseStats.total}
              size={76}
              strokeWidth={7}
            />
            <Text style={[styles.statSquareLabel, { color: colors.textSecondary }]}>
              Exercises completed
            </Text>
          </View>
        </Card>

        <Card style={styles.statSquare}>
          <View style={styles.statSquareContent}>
            <Text
              style={[
                styles.performanceScore,
                { color: model.performance.hasData ? performanceColor : colors.textMuted },
              ]}
            >
              {model.performance.hasData ? `${model.performance.score}%` : "--"}
            </Text>
            <Text style={[styles.statSquareLabel, { color: colors.textSecondary }]}>
              Today&apos;s performance
            </Text>
          </View>
        </Card>
      </View>

      {actions.onViewWorkoutStats ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View Day ${model.dayNumber} workout stats`}
          onPress={actions.onViewWorkoutStats}
          hitSlop={4}
          pressRetentionOffset={28}
          style={({ pressed }) => [
            styles.startWorkoutCard,
            styles.workoutStatsButton,
            {
              backgroundColor: colors.accent,
              opacity: pressed ? 0.84 : 1,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={styles.startWorkoutTextBlock}>
            <Text style={styles.startWorkoutTitle}>Workout Stats</Text>
            <Text style={styles.startWorkoutSubtitle}>View and share this day&apos;s results</Text>
          </View>
        </Pressable>
      ) : null}

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>This Week</Text>
      <Card style={styles.weekStatsCard}>
        <View style={styles.weekStat}>
          <BasketballIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Shots</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>{model.weeklyStats.shots}</Text>
        </View>
        <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.weekStat}>
          <PercentIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Accuracy</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>
            {model.weeklyStats.accuracy != null ? `${model.weeklyStats.accuracy}%` : "--"}
          </Text>
        </View>
        <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.weekStat}>
          <ChartLineUpIcon size={26} color={colors.accent} weight="duotone" />
          <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Weekly perf</Text>
          <Text style={[styles.weekStatValue, { color: colors.text }]}>
            {model.weeklyStats.averagePerformance != null
              ? `${model.weeklyStats.averagePerformance}%`
              : "--"}
          </Text>
        </View>
      </Card>

      <Pressable
        accessibilityRole="button"
        ref={startWorkoutTargetRef}
        onLayout={actions.onStartWorkoutLayout}
        onPressIn={actions.onStartWorkout}
        hitSlop={4}
        pressRetentionOffset={28}
        style={({ pressed }) => [
          styles.startWorkoutCard,
          {
            backgroundColor: colors.accent,
            opacity: pressed ? 0.84 : 1,
            shadowColor: colors.shadow,
          },
        ]}
      >
        <View style={styles.startWorkoutTextBlock}>
          <Text style={styles.startWorkoutTitle}>
            {model.isPastOrCompleted ? "View workout" : "Start workout"}
          </Text>
          <Text style={styles.startWorkoutSubtitle}>
            {model.isPastOrCompleted
              ? "Review or edit your logged drills"
              : "Start your personalized workout"}
          </Text>
        </View>
        <View style={styles.startWorkoutIcon}>
          <PlayCircleIcon size={40} color="#FFFFFF" weight="fill" />
        </View>
      </Pressable>

      {model.completed ? (
        <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
          <CheckCircleIcon size={16} color={colors.accent} weight="fill" />
          <Text style={[styles.completedBannerText, { color: colors.accent }]}>Workout complete</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dayLabel: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12, paddingHorizontal: 4 },
  statsSquareRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  statSquare: { flex: 1, aspectRatio: 1, padding: 14, justifyContent: "center" },
  statSquareContent: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  statSquareLabel: { fontSize: 12, fontWeight: "600", textAlign: "center", lineHeight: 16 },
  performanceScore: { fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  sectionLabel: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, paddingHorizontal: 4 },
  weekStatsCard: { flexDirection: "row", alignItems: "stretch", marginBottom: 16 },
  weekStat: { flex: 1, alignItems: "center", gap: 5 },
  weekStatDivider: { width: 1, marginVertical: 4 },
  weekStatLabel: { fontSize: 11, fontWeight: "700", textAlign: "center", lineHeight: 14 },
  weekStatValue: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  startWorkoutCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 20, paddingVertical: 18, paddingHorizontal: 20, marginTop: 4, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 6 },
  workoutStatsButton: { marginTop: 0, marginBottom: 20 },
  startWorkoutTextBlock: { flex: 1, paddingRight: 12 },
  startWorkoutTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  startWorkoutSubtitle: { color: "rgba(255,255,255,0.88)", fontSize: 13, fontWeight: "500", marginTop: 4, lineHeight: 18 },
  startWorkoutIcon: { alignItems: "center", justifyContent: "center" },
  completedBanner: { marginTop: 12, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  completedBannerText: { fontWeight: "800", fontSize: 15 },
});
