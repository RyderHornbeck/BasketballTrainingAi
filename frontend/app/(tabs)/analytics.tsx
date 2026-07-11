import { Card } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { AnalyticsSummary, getAnalyticsSummary } from "@/lib/analytics";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function formatPct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
          Your training numbers at a glance.
        </Text>

        <View style={styles.statsGrid}>
          <StatCard label="Workouts" value={String(summary.totalWorkoutsCompleted)} />
          <StatCard label="Streak" value={`${summary.currentStreak}d`} />
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Minutes" value={String(summary.totalMinutesTrained)} />
          <StatCard label="Plan Done" value={formatPct(summary.completionRate)} />
        </View>

        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Shooting</Text>
          <Text style={[styles.rowText, { color: colors.textSecondary }]}>
            Makes: {summary.totalMakes} · Misses: {summary.totalMisses}
          </Text>
          <Text style={[styles.rowText, { color: colors.textSecondary }]}>
            Overall: {formatPct(summary.shootingPercentage)}
          </Text>
          {summary.weeklyShooting.length > 0 ? (
            <View style={styles.list}>
              {summary.weeklyShooting.map((week) => (
                <Text key={week.label} style={[styles.listItem, { color: colors.textMuted }]}>
                  {week.label}: {formatPct(week.pct)} ({week.makes}/{week.attempts})
                </Text>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Log shooting drills to see weekly trends.
            </Text>
          )}
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Skills</Text>
          {summary.strongestSkill ? (
            <Text style={[styles.rowText, { color: colors.textSecondary }]}>
              Strongest: {summary.strongestSkill}
            </Text>
          ) : null}
          {summary.weakestSkill ? (
            <Text style={[styles.rowText, { color: colors.textSecondary }]}>
              Focus area: {summary.weakestSkill}
            </Text>
          ) : null}
          {summary.categoryStats.length > 0 ? (
            <View style={styles.list}>
              {summary.categoryStats.map((cat) => (
                <Text key={cat.category} style={[styles.listItem, { color: colors.textMuted }]}>
                  {cat.label}: {cat.drillsCompleted}/{cat.drillsTotal} drills
                  {cat.shootingPct != null ? ` · ${cat.shootingPct}%` : ""}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Complete workouts to see skill breakdowns.
            </Text>
          )}
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Workouts</Text>
          {summary.recentWorkouts.length > 0 ? (
            <View style={styles.list}>
              {summary.recentWorkouts.map((workout) => (
                <Text key={workout.id} style={[styles.listItem, { color: colors.textMuted }]}>
                  {workout.title ?? "Workout"} · {workout.totalMinutes ?? 0} min
                </Text>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Finish a workout to see your history here.
            </Text>
          )}
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
  sectionCard: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  rowText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  list: {
    marginTop: 8,
    gap: 6,
  },
  listItem: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
});
