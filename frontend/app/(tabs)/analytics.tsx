import { Card } from "@/components/Card";
import {
  MakesMissesChartPanel,
  SkillRadarChart,
  WorkoutPerformanceLineChart,
  WorkoutActivityHeatmap,
} from "@/components/analytics/AnalyticsCharts";
import { ShotMap } from "@/components/analytics/ShotMap";
import { StatCard } from "@/components/StatCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { AnalyticsSummary, getAnalyticsSummary } from "@/lib/analytics";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { useFocusEffect } from "expo-router";
import { BarbellIcon, FlameIcon } from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ANALYTICS_ORANGE = "#F7B379";

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async (mode: "initial" | "refresh" | "silent" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    if (mode === "initial") setLoading(true);
    try {
      const data = await getAnalyticsSummary();
      setSummary(data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return onWorkoutUpdated(() => {
      void load("silent");
    });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
      });
      void load("refresh");
      return () => cancelAnimationFrame(frame);
    }, [load])
  );

  if (loading && !summary) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: "transparent" }]} edges={["top"]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: "transparent" }]} edges={["top"]}>
        <Text style={{ color: colors.textSecondary }}>Could not load analytics.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: "transparent" }]} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={[styles.header, { color: colors.text }]}>Analytics</Text>
        <Text style={[styles.subheader, { color: colors.textSecondary }]}>
          Skill profile, shooting trends, and training consistency.
        </Text>

        <View style={styles.statsGrid}>
          <StatCard
            label="Workouts"
            value={String(summary.totalWorkoutsCompleted)}
            valueColor={ANALYTICS_ORANGE}
            icon={<BarbellIcon size={22} color={ANALYTICS_ORANGE} weight="duotone" />}
          />
          <StatCard
            label="day streak"
            value={String(summary.currentStreak)}
            valueColor={ANALYTICS_ORANGE}
            icon={<FlameIcon size={22} color={ANALYTICS_ORANGE} weight="duotone" />}
          />
        </View>

        <Card style={styles.chartCard}>
          <SkillRadarChart profile={summary.skillProfile} />
        </Card>

        <View style={styles.chartCard}>
          <ShotMap logs={summary.shotMapLogs} />
        </View>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Makes & Misses</Text>
          <MakesMissesChartPanel
            logs={summary.shootingLogs}
            firstActivityDate={summary.firstActivityDate}
          />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Workout Performance</Text>
          <WorkoutPerformanceLineChart points={summary.workoutPerformance} />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Training Activity</Text>
          <WorkoutActivityHeatmap data={summary.workoutHeatmap} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  header: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 6,
  },
  subheader: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  chartCard: {
    marginTop: 12,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
});
