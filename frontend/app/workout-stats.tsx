import { Card } from "@/components/Card";
import { ShotMap } from "@/components/analytics/ShotMap";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { calculateDayPerformance, getPerformanceColor } from "@/lib/dayPerformance";
import {
  aggregateObservedShots,
  buildSetPlan,
  decodeExerciseLogMeta,
  hydrateSetLogs,
} from "@/lib/exerciseSetLogs";
import { actionHaptic } from "@/lib/haptics";
import { getWorkoutDayWithExercises } from "@/lib/plan";
import { ShotMapLogEntry } from "@/lib/shotMap";
import { WorkoutDayWithExercises } from "@/types/plan";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library/legacy";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  ExportIcon,
} from "phosphor-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ViewShot, { ViewShotRef } from "react-native-view-shot";

const DRILL_CATEGORIES = [
  { key: "shooting", label: "Shooting" },
  { key: "ball_handling", label: "Handles" },
  { key: "finishing", label: "Finishing" },
  { key: "defense", label: "Defense" },
  { key: "conditioning", label: "Conditioning" },
] as const;

export default function WorkoutStatsScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ dayId?: string; dayNumber?: string }>();
  const dayId = typeof params.dayId === "string" ? params.dayId : null;
  const [day, setDay] = useState<WorkoutDayWithExercises | null>(null);
  const [loading, setLoading] = useState(Boolean(dayId));
  const [sharing, setSharing] = useState(false);
  const captureRef = useRef<ViewShotRef>(null);
  const requestedDayNumber = Number(params.dayNumber);
  const dayNumber = day?.day_number ?? (Number.isFinite(requestedDayNumber) ? requestedDayNumber : 1);
  const captureWidth = Math.min(500, Dimensions.get("window").width - 28);
  const shotMapWidth = Math.min(420, captureWidth - 122);

  useEffect(() => {
    let mounted = true;
    if (!dayId) return;
    void getWorkoutDayWithExercises(dayId)
      .then((detail) => {
        if (mounted) setDay(detail);
      })
      .catch((error) => {
        console.error("Failed to load workout stats:", error);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [dayId]);

  const summary = useMemo(() => {
    if (!day) {
      return {
        performance: 0,
        hasPerformance: false,
        makes: 0,
        shots: 0,
        misses: 0,
        shotMapLogs: [] as ShotMapLogEntry[],
        categoryCounts: Object.fromEntries(
          DRILL_CATEGORIES.map(({ key }) => [key, 0])
        ) as Record<string, number>,
      };
    }

    const performance = calculateDayPerformance(day.exercises);
    let makes = 0;
    let shots = 0;
    const categoryCounts = Object.fromEntries(
      DRILL_CATEGORIES.map(({ key }) => [key, 0])
    ) as Record<string, number>;
    const shotMapLogs: ShotMapLogEntry[] = [];

    for (const exercise of day.exercises) {
      const log = exercise.log;
      if (log?.completed && exercise.category && exercise.category in categoryCounts) {
        categoryCounts[exercise.category] += 1;
      }
      if (exercise.log_type !== "makes_attempts" || !log) continue;

      const plan = buildSetPlan(exercise);
      const setLogs = hydrateSetLogs(plan, decodeExerciseLogMeta(log.notes), log);
      const observed = aggregateObservedShots(setLogs);
      if (observed) {
        makes += observed.makes;
        shots += observed.attempts;
      }

      shotMapLogs.push({
        created_at: log.updated_at ?? log.created_at ?? day.created_at,
        completed: log.completed,
        notes: log.notes,
        makes: log.makes,
        attempts: log.attempts,
        workout_exercises: {
          category: exercise.category,
          name: exercise.name,
          instructions: exercise.instructions,
          set_side_labels: exercise.set_side_labels,
        },
      });
    }

    return {
      performance: performance.score,
      hasPerformance: performance.hasData,
      makes,
      shots,
      misses: Math.max(0, shots - makes),
      shotMapLogs,
      categoryCounts,
    };
  }, [day]);

  const performanceColor = summary.hasPerformance
    ? getPerformanceColor(summary.performance, colors)
    : colors.textMuted;

  const captureImage = useCallback(async () => {
    return await captureRef.current?.capture?.();
  }, []);

  const handleShare = async () => {
    if (sharing) return;
    actionHaptic();
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "Sharing is not available on this device.");
        return;
      }
      const uri = await captureImage();
      if (!uri) throw new Error("Unable to create workout stats image");
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: `Share Day ${dayNumber} workout stats`,
        UTI: "public.png",
      });
    } catch {
      Alert.alert("Could not share stats", "Please try again.");
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = async () => {
    if (sharing) return;
    actionHaptic();
    setSharing(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (!permission.granted) {
        Alert.alert(
          "Photos permission needed",
          "Allow Court Coach to save your workout stats image to Photos."
        );
        return;
      }
      const uri = await captureImage();
      if (!uri) throw new Error("Unable to create workout stats image");
      const cacheDirectory = FileSystem.cacheDirectory;
      if (!cacheDirectory) throw new Error("Temporary storage is unavailable");
      const sourceUri = uri.startsWith("file://") ? uri : `file://${uri}`;
      const exportUri = `${cacheDirectory}court-coach-day-${dayNumber}-${Date.now()}.png`;
      await FileSystem.copyAsync({ from: sourceUri, to: exportUri });
      try {
        await MediaLibrary.saveToLibraryAsync(exportUri);
      } finally {
        await FileSystem.deleteAsync(exportUri, { idempotent: true }).catch(() => {});
      }
      Alert.alert("Saved", "Your workout stats image was saved to Photos.");
    } catch (error) {
      console.error("Failed to save workout stats image:", error);
      Alert.alert("Could not save stats", "Please try again.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ArrowLeftIcon size={22} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Workout Stats</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <WorkoutStatsSkeleton />
      ) : !day ? (
        <View style={styles.errorState}>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Workout stats unavailable</Text>
          <Text style={[styles.errorCopy, { color: colors.textSecondary }]}>
            Return to Workouts and try again.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <ViewShot
              ref={captureRef}
              options={{ format: "png", quality: 1 }}
              style={[styles.captureFrame, { width: captureWidth }]}
            >
              <LinearGradient
                colors={["#FF6A00", "#FF9A3D", "#FFFFFF"]}
                locations={[0, 0.42, 1]}
                style={styles.shareCard}
              >
                <Text style={styles.imageDayLabel}>Day {dayNumber} Workout</Text>

                <StatsStrip
                  small
                  items={[
                    {
                      label: "Performance",
                      value: summary.hasPerformance ? `${summary.performance}%` : "--",
                      color: performanceColor,
                    },
                    { label: "Makes", value: String(summary.makes), color: colors.text },
                    { label: "Misses", value: String(summary.misses), color: colors.text },
                  ]}
                />

                <ShotMap
                  logs={summary.shotMapLogs}
                  width={shotMapWidth}
                  title="Shot Map"
                  subtitle="Shooting from this workout"
                  filterByWeek={false}
                  compact
                />

                <View style={styles.brandFooter}>
                  <Image
                    source={require("../assets/images/AppLogo.png")}
                    style={styles.brandLogo}
                    resizeMode="contain"
                  />
                  <Text style={styles.brandText}>Court Coach AI</Text>
                </View>
              </LinearGradient>
            </ViewShot>

            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Drills</Text>
            <StatsStrip
              compact
              items={DRILL_CATEGORIES.map(({ key, label }) => ({
                label,
                value: String(summary.categoryCounts[key] ?? 0),
                color: colors.text,
              }))}
            />
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              disabled={sharing}
              onPress={() => void handleShare()}
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: colors.accent, opacity: sharing || pressed ? 0.72 : 1 },
              ]}
            >
              <ExportIcon size={19} color="#FFFFFF" weight="bold" />
              <Text style={styles.primaryActionText}>Share</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={sharing}
              onPress={() => void handleDownload()}
              style={({ pressed }) => [
                styles.actionButton,
                styles.downloadButton,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.accent,
                  opacity: sharing || pressed ? 0.72 : 1,
                },
              ]}
            >
              <DownloadSimpleIcon size={19} color={colors.accent} weight="bold" />
              <Text style={[styles.downloadText, { color: colors.accent }]}>Download</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function StatsStrip({
  items,
  compact = false,
  small = false,
}: {
  items: { label: string; value: string; color: string }[];
  compact?: boolean;
  small?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Card
      style={[
        styles.statsCard,
        compact && styles.compactStatsCard,
        small && styles.smallStatsCard,
      ]}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
          <View style={styles.stat}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={[
                styles.statLabel,
                compact && styles.compactLabel,
                small && styles.smallStatLabel,
                { color: colors.textSecondary },
              ]}
            >
              {item.label}
            </Text>
            <Text
              style={[
                styles.statValue,
                compact && styles.compactValue,
                small && styles.smallStatValue,
                { color: item.color },
              ]}
            >
              {item.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </Card>
  );
}

function WorkoutStatsSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton width={92} height={14} borderRadius={6} />
      <Skeleton width="100%" height={88} borderRadius={22} />
      <Skeleton width="100%" height={430} borderRadius={24} />
      <Skeleton width={42} height={14} borderRadius={6} />
      <Skeleton width="100%" height={90} borderRadius={22} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  headerSpacer: { width: 40 },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  captureFrame: {
    aspectRatio: 4 / 5,
    alignSelf: "center",
  },
  shareCard: {
    flex: 1,
    borderRadius: 28,
    overflow: "hidden",
    padding: 12,
    gap: 6,
    justifyContent: "center",
  },
  imageDayLabel: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "800",
    paddingHorizontal: 2,
    alignSelf: "stretch",
    textAlign: "center",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 2,
    marginTop: 16,
  },
  statsCard: {
    minHeight: 82,
    paddingHorizontal: 8,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "stretch",
  },
  compactStatsCard: {
    minHeight: 78,
    paddingHorizontal: 4,
  },
  smallStatsCard: {
    minHeight: 66,
    paddingVertical: 8,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  compactLabel: {
    fontSize: 9,
  },
  smallStatLabel: {
    fontSize: 10,
  },
  statValue: {
    marginTop: 4,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  compactValue: {
    fontSize: 19,
  },
  smallStatValue: {
    fontSize: 19,
    marginTop: 2,
  },
  divider: {
    width: 1,
    marginVertical: 5,
  },
  brandFooter: {
    height: 36,
    marginTop: 2,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.88)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  brandLogo: {
    width: 22,
    height: 22,
  },
  brandText: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
  },
  actionButton: {
    flex: 1,
    height: 50,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  downloadButton: {
    borderWidth: 1.5,
  },
  primaryActionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  downloadText: {
    fontSize: 15,
    fontWeight: "800",
  },
  skeleton: {
    flex: 1,
    padding: 18,
    gap: 14,
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  errorCopy: {
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
});
