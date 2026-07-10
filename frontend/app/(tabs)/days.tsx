import { Card } from "@/components/Card";
import { DaySelector } from "@/components/DaySelector";
import { ExerciseCard } from "@/components/ExerciseCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import {
  ExerciseLogInput,
  finishWorkoutDay,
  getWorkoutDayWithExercises,
  isDayUnlocked,
  saveExerciseLog,
} from "@/lib/plan";
import { WorkoutDayWithExercises } from "@/types/plan";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DaysScreen() {
  const { colors } = useTheme();
  const { plan, days, loading: planLoading, refresh: refreshPlan } = usePlan();

  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [dayDetail, setDayDetail] = useState<WorkoutDayWithExercises | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const logsRef = useRef<Map<string, ExerciseLogInput>>(new Map());
  const finishingRef = useRef(false);

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

  // The AI voice coach can complete drills, save results, and finish the day.
  // Refetch whenever it writes so the screen stays in sync.
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

  const canViewDay = selectedDay
    ? selectedDay.completed || isDayUnlocked(selectedDay)
    : false;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <DaySelector
        days={days}
        selectedDayNumber={selectedDayNumber ?? 1}
        onSelect={setSelectedDayNumber}
      />

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
        ) : (
          <View>
            <View style={styles.focusBlock}>
              {dayDetail.focus ? (
                <Text style={[styles.focusText, { color: colors.text }]}>{dayDetail.focus}</Text>
              ) : null}
              {dayDetail.estimated_minutes ? (
                <Text style={[styles.durationText, { color: colors.textSecondary }]}>
                  {dayDetail.estimated_minutes} min
                </Text>
              ) : null}
            </View>

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
  focusBlock: {
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  focusText: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  durationText: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 6,
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
