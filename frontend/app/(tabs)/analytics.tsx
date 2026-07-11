import { Card } from "@/components/Card";
import {
  CompletionLineChart,
  MakesMissesBarChart,
  PeriodSelector,
  ShootingTrendLineChart,
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
          Shooting, completion, and training trends from your logged workouts.
        </Text>

        <View style={styles.statsGrid}>
          <StatCard label="Workouts" value={String(summary.totalWorkoutsCompleted)} />
          <StatCard label="Streak" value={`${summary.currentStreak}d`} />
        </View>
        <View style={styles.statsGrid}>
          <StatCard label="Minutes" value={String(summary.totalMinutesTrained)} />
          <StatCard
            label="Shooting %"
            value={summary.shootingPercentage != null ? `${summary.shootingPercentage}%` : "--"}
          />
        </View>
        <View style={styles.statsGrid}>
          <StatCard label="Makes" value={String(summary.totalMakes)} />
          <StatCard label="Misses" value={String(summary.totalMisses)} />
        </View>
        <View style={styles.statsGrid}>
          <StatCard label="Completion" value={`${summary.completionRate}%`} />
          <StatCard
            label="Avg Session"
            value={
              summary.totalWorkoutsCompleted > 0
                ? `${Math.round(summary.totalMinutesTrained / summary.totalWorkoutsCompleted)}m`
                : "--"
            }
          />
        </View>

        <View style={styles.rowGrid}>
          <Card style={styles.skillCard}>
            <Text style={[styles.skillLabel, { color: colors.textMuted }]}>Strongest</Text>
            <Text style={[styles.skillValue, { color: colors.accent }]}>
              {summary.strongestSkill ?? "Keep logging"}
            </Text>
          </Card>
          <Card style={styles.skillCard}>
            <Text style={[styles.skillLabel, { color: colors.textMuted }]}>Focus Area</Text>
            <Text style={[styles.skillValue, { color: colors.danger }]}>
              {summary.weakestSkill ?? "Keep logging"}
            </Text>
          </Card>
        </View>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Makes & Misses</Text>
          <PeriodSelector value={shootingPeriod} onChange={setShootingPeriod} />
          <MakesMissesBarChart buckets={summary.shootingByPeriod[shootingPeriod]} />
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

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Workouts</Text>
        {summary.recentWorkouts.length === 0 ? (
          <Card>
            <Text style={{ color: colors.textSecondary }}>No workouts logged yet.</Text>
          </Card>
        ) : (
          summary.recentWorkouts.map((w) => (
            <Card key={w.id} style={styles.historyCard}>
              <View>
                <Text style={[styles.historyTitle, { color: colors.text }]}>{w.title}</Text>
                <Text style={[styles.historyDate, { color: colors.textMuted }]}>
                  {new Date(w.completedAt).toLocaleDateString()}
                </Text>
              </View>
              {w.totalMinutes != null ? (
                <Text style={[styles.historyMinutes, { color: colors.accent }]}>{w.totalMinutes} min</Text>
              ) : null}
            </Card>
          ))
        )}
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
    marginBottom: 12,
  },
  rowGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  skillCard: {
    flex: 1,
  },
  skillLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  skillValue: {
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  chartCard: {
    marginTop: 12,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 24,
    marginBottom: 12,
  },
  historyCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  historyDate: {
    fontSize: 12,
    marginTop: 2,
  },
  historyMinutes: {
    fontSize: 14,
    fontWeight: "800",
  },
});
