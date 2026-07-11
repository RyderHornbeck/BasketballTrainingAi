import { Card } from "@/components/Card";
import { DaySelector } from "@/components/DaySelector";
import { ExerciseCard } from "@/components/ExerciseCard";
import { ProgressRing } from "@/components/ProgressRing";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { calculateDayPerformance, getPerformanceColor } from "@/lib/dayPerformance";
import {
  ExerciseLogInput,
  finishWorkoutDay,
  getWorkoutDayWithExercises,
  isDayUnlocked,
  requestNextBlockGeneration,
  saveExerciseLog,
} from "@/lib/plan";
import { WorkoutDayWithExercises } from "@/types/plan";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type DaysViewMode = "overview" | "workout";

export default function DaysScreen() {
  const { colors } = useTheme();
  const {
    plan,
    days,
    generationRequest,
    loading: planLoading,
    refresh: refreshPlan,
  } = usePlan();

  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<DaysViewMode>("overview");
  const [dayDetail, setDayDetail] = useState<WorkoutDayWithExercises | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [progressVersion, setProgressVersion] = useState(0);
  const logsRef = useRef<Map<string, ExerciseLogInput>>(new Map());
  const finishingRef = useRef(false);
  const [retryingBlock, setRetryingBlock] = useState(false);

  const defaultDayNumber = useMemo(() => {
    if (days.length === 0) return null;
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const nextUp = sorted.find((d) => !d.completed && isDayUnlocked(d));
    if (nextUp) return nextUp.day_number;
    const lastCompleted = [...sorted].reverse().find((d) => d.completed);
    if (lastCompleted) return lastCompleted.day_number;
    return sorted[0].day_number;
  }, [days]);

  useEffect(() => {
    if (selectedDayNumber == null && defaultDayNumber != null) {
      setSelectedDayNumber(defaultDayNumber);
    }
  }, [defaultDayNumber, selectedDayNumber]);

  useEffect(() => {
    if (selectedDayNumber == null) return;
    const selected = days.find((day) => day.day_number === selectedDayNumber);
    const next = days.find(
      (day) =>
        !day.completed &&
        isDayUnlocked(day) &&
        (day.day_number ?? 0) > selectedDayNumber
    );
    if (selected?.completed && next?.day_number != null) {
      setSelectedDayNumber(next.day_number);
    }
  }, [days, selectedDayNumber]);

  const selectedDay = days.find((d) => d.day_number === selectedDayNumber) ?? null;

  const loadDetail = useCallback(async () => {
    if (!selectedDay) return;
    setDetailLoading(true);
    try {
      const detail = await getWorkoutDayWithExercises(selectedDay.id);
      setDayDetail(detail);
      logsRef.current = new Map();
      detail?.exercises.forEach((ex) => {
        if (ex.log) {
          logsRef.current.set(ex.id, {
            exercise_id: ex.id,
            completed: ex.log.completed,
            makes: ex.log.makes,
            attempts: ex.log.attempts,
            minutes_completed: ex.log.minutes_completed,
            difficulty: ex.log.difficulty,
            notes: ex.log.notes,
          });
        }
      });
    } catch (err) {
      console.error("Failed to load day detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedDay]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setViewMode("overview");
  }, [selectedDayNumber]);

  useEffect(() => {
    return onWorkoutUpdated(() => {
      refreshPlan();
      loadDetail();
    });
  }, [refreshPlan, loadDetail]);

  const tryAutoFinishDay = useCallback(
    async (detail: WorkoutDayWithExercises) => {
      if (detail.completed || finishingRef.current) return;

      const allDone = detail.exercises.every((ex) => {
        const log = logsRef.current.get(ex.id);
        return log?.completed === true;
      });

      if (!allDone) return;

      finishingRef.current = true;
      try {
        const logs = detail.exercises.map(
          (ex) =>
            logsRef.current.get(ex.id) ?? {
              exercise_id: ex.id,
              completed: false,
            }
        );
        await finishWorkoutDay(detail, logs);
        await refreshPlan();
        await loadDetail();
      } catch (err) {
        console.error("Auto-finish day failed:", err);
      } finally {
        finishingRef.current = false;
      }
    },
    [refreshPlan, loadDetail]
  );

  const handleLogChange = useCallback(
    async (log: ExerciseLogInput) => {
      logsRef.current.set(log.exercise_id, log);
      setProgressVersion((v) => v + 1);
      if (!dayDetail || dayDetail.completed) return;

      try {
        await saveExerciseLog(dayDetail.id, log);
        await tryAutoFinishDay(dayDetail);
      } catch (err) {
        console.error("Failed to save exercise log:", err);
      }
    },
    [dayDetail, tryAutoFinishDay]
  );

  const handleSelectDay = useCallback((dayNumber: number) => {
    setSelectedDayNumber(dayNumber);
  }, []);

  const exerciseStats = useMemo(() => {
    if (!dayDetail) return { completed: 0, total: 0, progress: 0 };
    const total = dayDetail.exercises.length;
    const completed = dayDetail.exercises.filter((ex) => {
      const log = logsRef.current.get(ex.id);
      return log?.completed ?? ex.log?.completed ?? false;
    }).length;
    return {
      completed,
      total,
      progress: total > 0 ? completed / total : 0,
    };
  }, [dayDetail, progressVersion]);

  const dayPerformance = useMemo(() => {
    if (!dayDetail) return { score: 0, hasData: false };
    return calculateDayPerformance(dayDetail.exercises, logsRef.current);
  }, [dayDetail, progressVersion]);

  const performanceColor = getPerformanceColor(dayPerformance.score, colors);

  if (planLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: "transparent" }]} edges={["top"]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!plan || days.length === 0) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: "transparent" }]} edges={["top"]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No active plan yet.</Text>
      </SafeAreaView>
    );
  }

  const blockExhausted =
    days.length > 0 && days.every((day) => day.completed);
  const nextBlockIndex =
    days.length > 0
      ? Math.max(...days.map((day) => day.block_index ?? 1)) + 1
      : 2;

  const handleRetryBlock = useCallback(async () => {
    if (!plan || retryingBlock) return;
    setRetryingBlock(true);
    try {
      await requestNextBlockGeneration(plan.id, nextBlockIndex);
      await refreshPlan();
    } catch (err) {
      console.error("Failed to retry block generation:", err);
    } finally {
      setRetryingBlock(false);
    }
  }, [nextBlockIndex, plan, refreshPlan, retryingBlock]);

  const canViewDay = selectedDay
    ? selectedDay.completed || isDayUnlocked(selectedDay)
    : false;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <DaySelector
        days={days}
        selectedDayNumber={selectedDayNumber ?? 1}
        onSelect={handleSelectDay}
      />
      {plan &&
      generationRequest?.generation_type === "extend" &&
      (generationRequest.status === "pending" || generationRequest.status === "generating") ? (
        <View style={[styles.blockBanner, { backgroundColor: colors.accentMuted }]}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={{ color: colors.accent }}>Building your next five workouts...</Text>
        </View>
      ) : null}
      {plan &&
      blockExhausted &&
      generationRequest?.generation_type === "extend" &&
      generationRequest.status === "failed" ? (
        <View style={[styles.blockBanner, { backgroundColor: colors.cardAlt }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Couldn&apos;t build your next workouts
            </Text>
            <Text style={{ color: colors.textSecondary, marginTop: 4, fontSize: 13 }}>
              {generationRequest.error_message ?? "Tap retry to try again."}
            </Text>
          </View>
          <Pressable
            onPress={handleRetryBlock}
            disabled={retryingBlock}
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
          >
            {retryingBlock ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.retryButtonText}>Retry</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        refreshControl={
          <RefreshControl refreshing={detailLoading} onRefresh={loadDetail} tintColor={colors.accent} />
        }
      >
        {!selectedDay ? null : !canViewDay ? (
          <Card style={styles.lockedCard}>
            <Text style={styles.lockedEmoji}>🔒</Text>
            <Text style={[styles.lockedText, { color: colors.text }]}>
              Complete today&apos;s workout to unlock.
            </Text>
          </Card>
        ) : detailLoading || !dayDetail ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : viewMode === "overview" ? (
          <View>
            <Text style={[styles.dayLabel, { color: colors.textSecondary }]}>Day {selectedDayNumber}</Text>
            <View style={styles.statsSquareRow}>
              <Card style={styles.statSquare}>
                <View style={styles.statSquareContent}>
                  <ProgressRing
                    progress={exerciseStats.progress}
                    completed={exerciseStats.completed}
                    total={exerciseStats.total}
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
                      {
                        color: dayPerformance.hasData ? performanceColor : colors.textMuted,
                      },
                    ]}
                  >
                    {dayPerformance.hasData ? `${dayPerformance.score}%` : "--"}
                  </Text>
                  <Text style={[styles.statSquareLabel, { color: colors.textSecondary }]}>
                    Today&apos;s performance
                  </Text>
                </View>
              </Card>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Today&apos;s Goal</Text>
            <Card style={styles.goalCard}>
              <Text style={[styles.goalText, { color: colors.text }]}>
                {dayDetail.focus || "Personalized basketball workout"}
              </Text>
              {dayDetail.estimated_minutes ? (
                <Text style={[styles.goalMeta, { color: colors.textMuted }]}>
                  ~{dayDetail.estimated_minutes} min
                </Text>
              ) : null}
            </Card>

            <Pressable
              onPress={() => setViewMode("workout")}
              style={({ pressed }) => [
                styles.startWorkoutCard,
                {
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.92 : 1,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <View style={styles.startWorkoutTextBlock}>
                <Text style={styles.startWorkoutTitle}>Start workout</Text>
                <Text style={styles.startWorkoutSubtitle}>
                  Start your personalized workout
                </Text>
              </View>
              <View style={styles.startWorkoutIcon}>
                <Ionicons name="play-circle" size={40} color="#FFFFFF" />
              </View>
            </Pressable>

            {dayDetail.completed && (
              <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
                <Text style={[styles.completedBannerText, { color: colors.accent }]}>
                  ✓ Workout completed
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View>
            <Pressable
              onPress={() => setViewMode("overview")}
              style={styles.backRow}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={22} color={colors.accent} />
              <Text style={[styles.backText, { color: colors.accent }]}>Back to day overview</Text>
            </Pressable>

            <View style={styles.workoutHeader}>
              <Text style={[styles.workoutHeaderTitle, { color: colors.text }]}>
                {dayDetail.exercises.length}{" "}
                {dayDetail.exercises.length === 1 ? "exercise" : "exercises"}
              </Text>
              {dayDetail.estimated_minutes ? (
                <Text style={[styles.workoutHeaderMeta, { color: colors.textSecondary }]}>
                  ~{dayDetail.estimated_minutes} min workout
                </Text>
              ) : null}
            </View>

            <Text style={[styles.drillsLabel, { color: colors.textMuted }]}>Drills</Text>

            {dayDetail.exercises
              .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
              .map((exercise) => (
                <ExerciseCard
                  key={exercise.id}
                  exercise={exercise}
                  readOnly={dayDetail.completed}
                  onLogChange={handleLogChange}
                />
              ))}

            {dayDetail.completed && (
              <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
                <Text style={[styles.completedBannerText, { color: colors.accent }]}>
                  ✓ Workout completed
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 15,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 4,
    paddingBottom: 120,
  },
  blockBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  retryButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  lockedCard: {
    alignItems: "center",
    paddingVertical: 48,
    marginTop: 20,
  },
  lockedEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  lockedText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  statsSquareRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  statSquare: {
    flex: 1,
    aspectRatio: 1,
    padding: 14,
    justifyContent: "center",
  },
  statSquareContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  statSquareLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 16,
  },
  performanceScore: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  goalCard: {
    marginBottom: 16,
  },
  goalText: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  goalMeta: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  startWorkoutCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 4,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 6,
  },
  startWorkoutTextBlock: {
    flex: 1,
    paddingRight: 12,
  },
  startWorkoutTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  startWorkoutSubtitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 18,
  },
  startWorkoutIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  backText: {
    fontSize: 15,
    fontWeight: "700",
  },
  workoutHeader: {
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  workoutHeaderTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  workoutHeaderMeta: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  drillsLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  completedBanner: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  completedBannerText: {
    fontWeight: "800",
    fontSize: 15,
  },
});
