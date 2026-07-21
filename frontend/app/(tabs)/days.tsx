import { Card } from "@/components/Card";
import { DaySelector } from "@/components/DaySelector";
import { ExerciseCard } from "@/components/ExerciseCard";
import { ProgressRing } from "@/components/ProgressRing";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { reportNetworkFailure } from "@/lib/connectivity";
import { calculateDayPerformance, getPerformanceColor } from "@/lib/dayPerformance";
import {
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
} from "@/lib/exerciseSetLogs";
import { actionHaptic, selectionHaptic } from "@/lib/haptics";
import { sortWorkoutExercisesForDisplay } from "@/lib/workoutOrder";
import {
  ExerciseLogInput,
  finishWorkoutDay,
  getCurrentWorkoutStreak,
  getWorkoutDayWithExercises,
  getWeeklyWorkoutStats,
  isDayUnlocked,
  removeExerciseFromWorkout,
  requestPlanGeneration,
  requestNextBlockGeneration,
  saveExerciseLog,
  WeeklyWorkoutStats,
} from "@/lib/plan";
import { ExerciseLog } from "@/types/database";
import { WorkoutDayWithExercises } from "@/types/plan";
import {
  CaretLeftIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  BasketballIcon,
  FireIcon,
  PercentIcon,
  MagicWandIcon,
  LockIcon,
  PlusIcon,
  PlayCircleIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  TargetIcon,
  TimerIcon,
} from "phosphor-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type DaysViewMode = "overview" | "workout";

export default function DaysScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
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
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [progressVersion, setProgressVersion] = useState(0);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyWorkoutStats>({
    shots: 0,
    accuracy: null,
    averagePerformance: null,
  });
  const [currentStreak, setCurrentStreak] = useState(0);
  const logsRef = useRef<Map<string, ExerciseLogInput>>(new Map());
  const detailCacheRef = useRef<Map<string, WorkoutDayWithExercises | null>>(new Map());
  const detailRequestsRef = useRef<Map<string, Promise<WorkoutDayWithExercises | null>>>(new Map());
  const selectedDayIdRef = useRef<string | null>(null);
  const logSaveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const latestLogInputRef = useRef<Map<string, ExerciseLogInput>>(new Map());
  const logSaveErrorShownRef = useRef(false);
  const initialGenerationAttemptedRef = useRef(false);
  const finishingRef = useRef(false);
  const [finishingWorkout, setFinishingWorkout] = useState(false);
  const [retryingBlock, setRetryingBlock] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState(false);
  const [completionAnimationTokens, setCompletionAnimationTokens] = useState<Record<string, number>>({});

  const defaultDayNumber = useMemo(() => {
    if (days.length === 0) return null;
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const nextUp = sorted.find((d) => !d.completed && isDayUnlocked(d, sorted));
    if (nextUp) return nextUp.day_number;
    const lastCompleted = [...sorted].reverse().find((d) => d.completed);
    if (lastCompleted) return lastCompleted.day_number;
    return sorted[0].day_number;
  }, [days]);

  useEffect(() => {
    if (
      planLoading ||
      plan ||
      generationRequest ||
      initialGenerationAttemptedRef.current
    ) {
      return;
    }
    initialGenerationAttemptedRef.current = true;
    void requestPlanGeneration()
      .then(refreshPlan)
      .catch((generationError) => {
        console.error("Unable to start initial plan generation:", generationError);
      });
  }, [generationRequest, plan, planLoading, refreshPlan]);

  useEffect(() => {
    if (selectedDayNumber == null && defaultDayNumber != null) {
      setSelectedDayNumber(defaultDayNumber);
    }
  }, [defaultDayNumber, selectedDayNumber]);

  const selectedDay = days.find((d) => d.day_number === selectedDayNumber) ?? null;
  const selectedDayId = selectedDay?.id ?? null;

  useEffect(() => {
    selectedDayIdRef.current = selectedDayId;
  }, [selectedDayId]);

  const applySelectedDetail = useCallback((detail: WorkoutDayWithExercises | null) => {
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
  }, []);

  const fetchDayDetail = useCallback(async (dayId: string, force = false) => {
    if (!force) {
      const cached = detailCacheRef.current.get(dayId);
      if (cached !== undefined) return cached;
      const inFlight = detailRequestsRef.current.get(dayId);
      if (inFlight) return inFlight;
    }

    const request = getWorkoutDayWithExercises(dayId)
      .then((detail) => {
        detailCacheRef.current.set(dayId, detail);
        return detail;
      })
      .finally(() => detailRequestsRef.current.delete(dayId));
    detailRequestsRef.current.set(dayId, request);
    return request;
  }, []);

  // Day details are cached so navigating between overview and workout is
  // instant. Persist the server-returned row into that cache after every
  // successful save; otherwise reopening a workout can show its pre-save log
  // until a full app reload triggers a fresh fetch.
  const updateCachedExerciseLog = useCallback((dayId: string, savedLog: ExerciseLog) => {
    const applySavedLog = (detail: WorkoutDayWithExercises) => ({
      ...detail,
      exercises: detail.exercises.map((exercise) =>
        exercise.id === savedLog.exercise_id ? { ...exercise, log: savedLog } : exercise
      ),
    });

    const cached = detailCacheRef.current.get(dayId);
    if (cached) detailCacheRef.current.set(dayId, applySavedLog(cached));

    // The overview/workout toggle keeps this screen mounted. Keep the active
    // detail in sync too, otherwise it renders the old row until a tab focus
    // event happens to reload it.
    setDayDetail((current) =>
      current?.id === dayId ? applySavedLog(current) : current
    );
  }, []);

  const loadDetail = useCallback(
    async (showLoading = false, force = false) => {
      if (!selectedDayId) return;
      const cached = !force ? detailCacheRef.current.get(selectedDayId) : undefined;
      if (cached !== undefined) {
        applySelectedDetail(cached);
        return;
      }
      if (showLoading) setDetailLoading(true);
      try {
        const detail = await fetchDayDetail(selectedDayId, force);
        if (selectedDayIdRef.current === selectedDayId) applySelectedDetail(detail);
      } catch (err) {
        console.error("Failed to load day detail:", err);
      } finally {
        if (showLoading) setDetailLoading(false);
      }
    },
    [applySelectedDetail, fetchDayDetail, selectedDayId]
  );

  useEffect(() => {
    void loadDetail(!dayDetail);
  }, [selectedDayId, loadDetail]);

  useEffect(() => {
    if (selectedDayNumber == null) return;
    const neighbors = [selectedDayNumber - 1, selectedDayNumber + 1]
      .map((dayNumber) => days.find((day) => day.day_number === dayNumber)?.id)
      .filter((id): id is string => Boolean(id));
    neighbors.forEach((dayId) => {
      void fetchDayDetail(dayId).catch((err) => {
        console.warn("Failed to prefetch workout day:", err);
      });
    });
  }, [days, fetchDayDetail, selectedDayNumber]);

  const loadWeeklyStats = useCallback(async () => {
    try {
      setWeeklyStats(await getWeeklyWorkoutStats());
    } catch (err) {
      console.error("Failed to load weekly workout stats:", err);
    }
  }, []);

  useEffect(() => {
    loadWeeklyStats();
  }, [loadWeeklyStats]);

  const loadCurrentStreak = useCallback(async () => {
    try {
      setCurrentStreak(await getCurrentWorkoutStreak());
    } catch (err) {
      console.error("Failed to load workout streak:", err);
    }
  }, []);

  useEffect(() => {
    loadCurrentStreak();
  }, [loadCurrentStreak]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const moveToCurrentWorkoutAfterMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 15, 0);
      timer = setTimeout(() => {
        setSelectedDayNumber(null);
        setViewMode("overview");
        void refreshPlan();
        moveToCurrentWorkoutAfterMidnight();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime()));
    };

    moveToCurrentWorkoutAfterMidnight();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [refreshPlan]);

  useFocusEffect(
    useCallback(
      () => {
        void refreshPlan();
        void loadDetail(false);
        void loadWeeklyStats();
        void loadCurrentStreak();
        return () => {
          // Exercise additions and removals persist immediately; leaving only
          // closes edit mode and never discards a draft.
          setEditingWorkout(false);
        };
      },
      [refreshPlan, loadDetail, loadWeeklyStats, loadCurrentStreak]
    )
  );

  useEffect(() => {
    return onWorkoutUpdated((source) => {
      // Manual cards already hold the latest optimistic state. Reloading them
      // here would overwrite in-progress typing and make toggles flicker.
      if (source === "manual") {
        void loadWeeklyStats();
        return;
      }
      detailCacheRef.current.clear();
      void refreshPlan();
      void loadDetail(false, true);
      void loadWeeklyStats();
      void loadCurrentStreak();
    });
  }, [refreshPlan, loadDetail, loadWeeklyStats, loadCurrentStreak]);

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
        await Promise.all([refreshPlan(), loadDetail(false, true)]);
      } catch (err) {
        console.error("Auto-finish day failed:", err);
        reportNetworkFailure("finish-workout");
      } finally {
        finishingRef.current = false;
      }
    },
    [refreshPlan, loadDetail]
  );

  const confirmFinishWorkout = useCallback(() => {
    if (!dayDetail || dayDetail.completed || finishingRef.current) return;
    actionHaptic();

    const logs = dayDetail.exercises.map(
      (exercise) =>
        logsRef.current.get(exercise.id) ?? {
          exercise_id: exercise.id,
          completed: false,
        }
    );
    const incompleteCount = logs.filter((log) => !log.completed).length;
    const message =
      incompleteCount > 0
        ? `${incompleteCount} ${incompleteCount === 1 ? "drill is" : "drills are"} unfinished. Finish anyway? Completed drill data will be saved, and the next workout will unlock.`
        : "Finish this workout and unlock the next one?";

    Alert.alert("Finish workout?", message, [
      { text: "Keep working", style: "cancel" },
      {
        text: "Finish workout",
        onPress: () => {
          void (async () => {
            finishingRef.current = true;
            setFinishingWorkout(true);
            try {
              await finishWorkoutDay(dayDetail, logs);
              await Promise.all([
                refreshPlan(),
                loadDetail(false),
                loadWeeklyStats(),
                loadCurrentStreak(),
              ]);
            } catch (err) {
              reportNetworkFailure("finish-workout");
              Alert.alert(
                "Could not finish workout",
                err instanceof Error ? err.message : "Please try again."
              );
            } finally {
              finishingRef.current = false;
              setFinishingWorkout(false);
            }
          })();
        },
      },
    ]);
  }, [dayDetail, loadCurrentStreak, loadDetail, loadWeeklyStats, refreshPlan]);

  const handleLogChange = useCallback(
    (log: ExerciseLogInput) => {
      const previousLog =
        logsRef.current.get(log.exercise_id) ??
        dayDetail?.exercises.find((exercise) => exercise.id === log.exercise_id)?.log;
      logsRef.current.set(log.exercise_id, log);
      latestLogInputRef.current.set(log.exercise_id, log);
      setProgressVersion((v) => v + 1);
      if (!dayDetail) return;
      if (!previousLog?.completed && log.completed) {
        setCompletionAnimationTokens((tokens) => ({
          ...tokens,
          [log.exercise_id]: Date.now(),
        }));
      }

      // Save rapid edits in order per exercise. Without this, a slower request
      // for an earlier keystroke/toggle can overwrite the user's later value.
      const previous = logSaveQueuesRef.current.get(log.exercise_id) ?? Promise.resolve();
      const save = previous
        .catch(() => undefined)
        .then(async () => {
          const savedLog = await saveExerciseLog(dayDetail.id, log);
          if (latestLogInputRef.current.get(log.exercise_id) !== log) return;
          updateCachedExerciseLog(dayDetail.id, savedLog);
          logSaveErrorShownRef.current = false;
          if (!dayDetail.completed) {
            await tryAutoFinishDay(dayDetail);
          }
        })
        .catch((err) => {
          console.error("Failed to save exercise log:", err);
          reportNetworkFailure("save-workout-progress");
          if (!logSaveErrorShownRef.current) {
            logSaveErrorShownRef.current = true;
            Alert.alert(
              "Could not save workout progress",
              err instanceof Error ? err.message : "Please try again."
            );
          }
        });
      logSaveQueuesRef.current.set(log.exercise_id, save);
    },
    [dayDetail, tryAutoFinishDay, updateCachedExerciseLog]
  );

  const handleSelectDay = useCallback(
    (dayNumber: number) => {
      const currentDayNumber = selectedDayNumber ?? dayNumber;
      if (dayNumber === currentDayNumber) return;
      selectionHaptic();

      const nextDayId = days.find((day) => day.day_number === dayNumber)?.id;
      const cached = nextDayId ? detailCacheRef.current.get(nextDayId) : undefined;
      if (cached !== undefined) {
        applySelectedDetail(cached);
      } else {
        setDayDetail(null);
      }
      setViewMode("overview");
      setEditingWorkout(false);
      setSelectedDayNumber(dayNumber);
    },
    [applySelectedDetail, days, selectedDayNumber]
  );

  const switchViewMode = useCallback((nextMode: DaysViewMode) => {
    setViewMode(nextMode);
  }, []);

  const confirmDeleteExercise = useCallback(
    (exerciseId: string, exerciseName: string | null) => {
      if (!dayDetail) return;
      actionHaptic();
      Alert.alert(
        "Delete exercise?",
        `Are you sure you want to delete ${exerciseName ?? "this exercise"}? Its logged results will also be removed from analytics.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void removeExerciseFromWorkout(dayDetail.id, exerciseId).catch((err) => {
                console.error("Failed to delete exercise:", err);
                reportNetworkFailure("delete-exercise");
                Alert.alert("Could not delete exercise", err instanceof Error ? err.message : "Try again.");
              });
            },
          },
        ]
      );
    },
    [dayDetail]
  );

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

  const dayShootingStats = useMemo(() => {
    if (!dayDetail) return { shots: 0, makes: 0, accuracy: null as number | null };
    let shots = 0;
    let makes = 0;

    for (const exercise of dayDetail.exercises) {
      if (exercise.log_type !== "makes_attempts") continue;
      const log = logsRef.current.get(exercise.id) ?? exercise.log;
      if (!log) continue;
      const plan = buildSetPlan(exercise);
      const setLogs = hydrateSetLogs(plan, decodeExerciseLogMeta(log.notes), log);
      for (const set of setLogs) {
        if (!set.completed) continue;
        const setMakes = set.makes ?? 0;
        makes += setMakes;
        shots += set.attempts ?? plan.perSetAttempts ?? setMakes;
      }
    }

    return {
      shots,
      makes,
      accuracy: shots > 0 ? Math.round((makes / shots) * 100) : null,
    };
  }, [dayDetail, progressVersion]);

  const performanceColor = getPerformanceColor(dayPerformance.score, colors);

  const blockExhausted = useMemo(
    () => days.length > 0 && days.every((day) => day.completed),
    [days]
  );

  const nextBlockIndex = useMemo(
    () =>
      days.length > 0 ? Math.max(...days.map((day) => day.block_index ?? 1)) + 1 : 2,
    [days]
  );

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
    ? selectedDay.completed || isDayUnlocked(selectedDay, days)
    : false;
  const isPastOrCompletedDay =
    selectedDay?.completed === true ||
    (defaultDayNumber != null && (selectedDayNumber ?? 0) < defaultDayNumber);
  const lockedDayMessage = useMemo(() => {
    if (!selectedDay || isDayUnlocked(selectedDay, days)) {
      return "Complete today’s workout to unlock.";
    }
    const previousDay = Math.max(1, (selectedDay.day_number ?? 1) - 1);
    return `Complete the previous workout to unlock Day ${selectedDay.day_number ?? ""}.`;
  }, [days, selectedDay]);
  const initialPlanBuilding =
    !plan &&
    (!generationRequest ||
      (generationRequest.generation_type === "initial" &&
        (generationRequest.status === "pending" ||
          generationRequest.status === "generating")));

  if (planLoading || initialPlanBuilding) {
    return <DaysSkeleton />;
  }

  if (!plan || days.length === 0) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: "transparent" }]} edges={["top"]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No active plan yet.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <View style={styles.selectorHeader}>
        <DaySelector
          days={days}
          selectedDayNumber={selectedDayNumber ?? 1}
          currentDayNumber={defaultDayNumber ?? 1}
          onSelect={handleSelectDay}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View achievements. Current streak ${currentStreak} days`}
          onPress={() => {
            actionHaptic();
            router.push("/achievements");
          }}
          style={({ pressed }) => [
            styles.streakBadge,
            {
              backgroundColor: scheme === "dark" ? colors.card : "#FFFFFF",
              opacity: pressed ? 0.82 : 1,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <FireIcon size={23} color="#F97316" weight="fill" />
          <Text
            style={[
              styles.streakValue,
              { color: currentStreak > 0 ? (scheme === "dark" ? "#FFFFFF" : "#111113") : "#8E8E93" },
            ]}
          >
            {currentStreak}
          </Text>
        </Pressable>
      </View>
      {plan &&
      generationRequest?.generation_type === "extend" &&
      (generationRequest.status === "pending" || generationRequest.status === "generating") ? (
        <View style={[styles.blockBanner, { backgroundColor: colors.accentMuted }]}>
          <Skeleton width={22} height={22} borderRadius={11} />
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
              <Text style={styles.retryButtonText}>Retrying...</Text>
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
          <RefreshControl
            refreshing={detailRefreshing}
            onRefresh={() => {
              if (selectedDayId) detailCacheRef.current.delete(selectedDayId);
              setDetailRefreshing(true);
              void loadDetail(false, true).finally(() => setDetailRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View>
        {!selectedDay ? null : !canViewDay ? (
          <Card style={styles.lockedCard}>
            <LockIcon size={40} color={colors.textMuted} weight="duotone" />
            <Text style={[styles.lockedText, { color: colors.text }]}>
              {lockedDayMessage}
            </Text>
          </Card>
        ) : detailLoading || !dayDetail ? (
          <DayContentSkeleton viewMode={viewMode} />
        ) : viewMode === "overview" ? (
          <View>
            <Text style={[styles.dayLabel, { color: colors.textSecondary }]}>
              Day {selectedDayNumber}
              {isPastOrCompletedDay ? " · Past workout" : ""}
            </Text>
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

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>This Week</Text>
            <Card style={styles.weekStatsCard}>
              <View style={styles.weekStat}>
                <BasketballIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Shots</Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {weeklyStats.shots}
                </Text>
              </View>
              <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weekStat}>
                <PercentIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Accuracy</Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {weeklyStats.accuracy != null ? `${weeklyStats.accuracy}%` : "--"}
                </Text>
              </View>
              <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weekStat}>
                <ChartLineUpIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>
                  Weekly perf
                </Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {weeklyStats.averagePerformance != null
                    ? `${weeklyStats.averagePerformance}%`
                    : "--"}
                </Text>
              </View>
            </Card>

            <Pressable
              accessibilityRole="button"
              onPressIn={() => {
                // This CTA sits inside a ScrollView. Run the local-only action
                // on touch-down so a slight vertical movement cannot let the
                // ScrollView cancel the intended tap before onPress fires.
                actionHaptic();
                switchViewMode("workout");
              }}
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
                  {isPastOrCompletedDay ? "View workout" : "Start workout"}
                </Text>
                <Text style={styles.startWorkoutSubtitle}>
                  {isPastOrCompletedDay
                    ? "Review or edit your logged drills"
                    : "Start your personalized workout"}
                </Text>
              </View>
              <View style={styles.startWorkoutIcon}>
                <PlayCircleIcon size={40} color="#FFFFFF" weight="fill" />
              </View>
            </Pressable>

            {dayDetail.completed && (
              <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
                <CheckCircleIcon size={16} color={colors.accent} weight="fill" />
                <Text style={[styles.completedBannerText, { color: colors.accent }]}>
                  Workout complete
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View>
            <Pressable
              onPress={() => {
                actionHaptic();
                setEditingWorkout(false);
                switchViewMode("overview");
              }}
              style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.65 : 1 }]}
              hitSlop={8}
            >
              <CaretLeftIcon size={22} color={colors.accent} weight="bold" />
              <Text style={[styles.backText, { color: colors.accent }]}>Back to day overview</Text>
            </Pressable>

            <View style={styles.dayWorkoutTopRow}>
              <Text style={[styles.dayWorkoutLabel, { color: colors.textMuted }]}>
                Day {dayDetail.day_number} Workout
              </Text>
              <Pressable
                onPress={() => {
                  actionHaptic();
                  setEditingWorkout((value) => !value);
                }}
                style={({ pressed }) => [
                  styles.editWorkoutButton,
                  {
                    backgroundColor: editingWorkout ? colors.accent : colors.card,
                    borderColor: colors.accent,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                {editingWorkout ? (
                  <FloppyDiskIcon size={15} color="#FFFFFF" weight="bold" />
                ) : (
                  <PencilSimpleIcon size={15} color={colors.accent} weight="bold" />
                )}
                <Text
                  style={[
                    styles.editWorkoutButtonText,
                    { color: editingWorkout ? "#FFFFFF" : colors.accent },
                  ]}
                >
                  {editingWorkout ? "Save changes" : "Edit"}
                </Text>
              </Pressable>
            </View>
            <Card style={styles.workoutStatsCard}>
              <View style={styles.weekStat}>
                <BasketballIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Shots</Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {dayShootingStats.shots}
                </Text>
              </View>
              <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weekStat}>
                <TargetIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Makes</Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {dayShootingStats.makes}
                </Text>
              </View>
              <View style={[styles.weekStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weekStat}>
                <PercentIcon size={26} color={colors.accent} weight="duotone" />
                <Text style={[styles.weekStatLabel, { color: colors.textSecondary }]}>Accuracy</Text>
                <Text style={[styles.weekStatValue, { color: colors.text }]}>
                  {dayShootingStats.accuracy != null ? `${dayShootingStats.accuracy}%` : "--"}
                </Text>
              </View>
            </Card>

            {editingWorkout ? (
              <View style={styles.addWorkoutActions}>
                <Pressable
                  onPress={() => {
                    actionHaptic();
                    router.push({
                      pathname: "/workout-edit-ai",
                      params: { dayId: dayDetail.id },
                    });
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
                    router.push({
                      pathname: "/workout-edit-manual",
                      params: { dayId: dayDetail.id },
                    });
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

            <View style={styles.workoutHeader}>
              <Text style={[styles.workoutHeaderTitle, { color: colors.text }]}>
                {dayDetail.exercises.length}{" "}
                {dayDetail.exercises.length === 1 ? "exercise" : "exercises"}
              </Text>
              {dayDetail.estimated_minutes ? (
                <View style={styles.workoutHeaderMetaRow}>
                  <TimerIcon size={14} color={colors.textSecondary} weight="duotone" />
                  <Text style={[styles.workoutHeaderMeta, { color: colors.textSecondary }]}>
                    ~{dayDetail.estimated_minutes} min workout
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={[styles.drillsLabel, { color: colors.textMuted }]}>Drills</Text>

            {sortWorkoutExercisesForDisplay(dayDetail.exercises).map((exercise) => (
                <ExerciseCard
                  key={exercise.id}
                  exercise={exercise}
                  readOnly={false}
                  editMode={editingWorkout}
                  completionAnimationToken={completionAnimationTokens[exercise.id]}
                  onDelete={() => confirmDeleteExercise(exercise.id, exercise.name)}
                  onLogChange={handleLogChange}
                />
              ))}

            {dayDetail.completed ? (
              <View style={[styles.completedBanner, { backgroundColor: colors.accentMuted }]}>
                <CheckCircleIcon size={16} color={colors.accent} weight="fill" />
                <Text style={[styles.completedBannerText, { color: colors.accent }]}>
                  Workout complete
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={confirmFinishWorkout}
                disabled={finishingWorkout}
                style={({ pressed }) => [
                  styles.finishWorkoutButton,
                  {
                    backgroundColor: colors.accent,
                    opacity: finishingWorkout || pressed ? 0.86 : 1,
                    shadowColor: colors.accent,
                  },
                ]}
              >
                {finishingWorkout ? (
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
        )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DaysSkeleton() {
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <View style={styles.daysSkeletonSelector}>
        <View style={styles.daysSkeletonPills}>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} width={46} height={46} borderRadius={23} />
          ))}
        </View>
        <Skeleton width={58} height={42} borderRadius={21} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
      >
        <DayContentSkeleton viewMode="overview" />
      </ScrollView>
    </SafeAreaView>
  );
}

function DayContentSkeleton({ viewMode }: { viewMode: DaysViewMode }) {
  if (viewMode === "workout") {
    return (
      <View>
        <Skeleton width={175} height={20} borderRadius={8} style={styles.skeletonLineBottom} />
        <View style={styles.skeletonWorkoutHeading}>
          <Skeleton width={115} height={18} borderRadius={7} />
          <Skeleton width={78} height={34} borderRadius={17} />
        </View>
        <Skeleton height={112} borderRadius={18} style={styles.skeletonSection} />
        <View style={styles.skeletonWorkoutMeta}>
          <Skeleton width={90} height={22} borderRadius={8} />
          <Skeleton width={120} height={16} borderRadius={7} />
        </View>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={150} borderRadius={18} style={styles.skeletonSection} />
        ))}
      </View>
    );
  }

  return (
    <View>
      <Skeleton width={125} height={18} borderRadius={7} style={styles.skeletonLineBottom} />
      <View style={styles.statsSquareRow}>
        <Skeleton width="auto" height={170} style={styles.skeletonStatSquare} />
        <Skeleton width="auto" height={170} style={styles.skeletonStatSquare} />
      </View>
      <Skeleton width={82} height={17} borderRadius={7} style={styles.skeletonLabel} />
      <Skeleton height={126} borderRadius={18} />
      <Skeleton height={92} borderRadius={18} style={styles.skeletonSection} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  selectorHeader: {
    position: "relative",
  },
  streakBadge: {
    position: "absolute",
    top: 6,
    right: 12,
    zIndex: 30,
    minWidth: 62,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 3,
  },
  streakValue: {
    fontSize: 18,
    fontWeight: "800",
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
  daysSkeletonSelector: {
    minHeight: 74,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  daysSkeletonPills: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    gap: 6,
  },
  skeletonLineBottom: {
    marginBottom: 14,
  },
  skeletonStatSquare: {
    flex: 1,
  },
  skeletonLabel: {
    marginBottom: 10,
  },
  skeletonSection: {
    marginTop: 14,
  },
  skeletonWorkoutHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  skeletonWorkoutMeta: {
    marginTop: 22,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  lockedText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 12,
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
  weekStatsCard: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: 16,
  },
  weekStat: {
    flex: 1,
    alignItems: "center",
    gap: 5,
  },
  weekStatDivider: {
    width: 1,
    marginVertical: 4,
  },
  weekStatLabel: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
  },
  weekStatValue: {
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.5,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  dayWorkoutTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayWorkoutLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  workoutStatsCard: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: 18,
  },
  editWorkoutButton: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  editWorkoutButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  addWorkoutActions: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  addWorkoutButton: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  addWorkoutAIButton: {
    borderWidth: 0,
  },
  addWorkoutButtonText: {
    fontSize: 13,
    fontWeight: "800",
  },
  workoutHeaderTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  workoutHeaderMeta: {
    fontSize: 14,
    fontWeight: "600",
  },
  workoutHeaderMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  completedBannerText: {
    fontWeight: "800",
    fontSize: 15,
  },
  finishWorkoutButton: {
    marginTop: 18,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 4,
  },
  finishWorkoutButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
});
