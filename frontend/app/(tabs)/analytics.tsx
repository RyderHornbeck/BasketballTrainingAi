import { Card } from "@/components/Card";
import {
  CompletionLineChart,
  MakesMissesBarChart,
  PeriodSelector,
  ShootingTrendLineChart,
  SkillRadarChart,
  WorkoutActivityHeatmap,
} from "@/components/analytics/AnalyticsCharts";
import { StatCard } from "@/components/StatCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { AnalyticsPeriod, AnalyticsSummary, getAnalyticsSummary } from "@/lib/analytics";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shootingPeriod, setShootingPeriod] = useState<AnalyticsPeriod>("weekly");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getAnalyticsSummary();
      setSummary(data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return onWorkoutUpdated(() => {
      load(true);
    });
  }, [load]);

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
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
        }
      >
        <Text style={[styles.header, { color: colors.text }]}>Analytics</Text>
        <Text style={[styles.subheader, { color: colors.textSecondary }]}>
          Skill profile, shooting trends, and training consistency.
        </Text>

        <View style={styles.statsGrid}>
          <StatCard label="Workouts" value={String(summary.totalWorkoutsCompleted)} />
          <StatCard label="day streak" value={String(summary.currentStreak)} />
        </View>

        <Card style={styles.chartCard}>
          <SkillRadarChart profile={summary.skillProfile} />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Makes & Misses</Text>
          <PeriodSelector value={shootingPeriod} onChange={setShootingPeriod} />
          <MakesMissesBarChart buckets={summary.shootingByPeriod[shootingPeriod] ?? []} />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Shooting % Trend</Text>
          <ShootingTrendLineChart
            buckets={summary.weeklyShooting.map((w) => ({ label: w.label, pct: w.pct }))}
          />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Workout Completion Rate</Text>
          <CompletionLineChart points={summary.completionTrend} />
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
