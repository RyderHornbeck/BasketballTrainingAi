import { Card } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { AnalyticsSummary, CategoryStats, getAnalyticsSummary } from "@/lib/analytics";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function HorizontalBar({
  label,
  value,
  max,
  color,
  suffix = "",
  mutedColor,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  suffix?: string;
  mutedColor: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 0) : 0;
  return (
    <View style={styles.hBarRow}>
      <Text style={[styles.hBarLabel, { color: mutedColor }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.hBarTrackWrap}>
        <View style={[styles.hBarTrack, { backgroundColor: "rgba(128,128,128,0.15)" }]}>
          <View style={[styles.hBarFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.hBarValue, { color }]}>{`${value}${suffix}`}</Text>
      </View>
    </View>
  );
}

function LineTrendChart({
  data,
  accentColor,
  mutedColor,
  textColor,
}: {
  data: { label: string; pct: number | null }[];
  accentColor: string;
  mutedColor: string;
  textColor: string;
}) {
  const validPoints = data.filter((d) => d.pct != null);
  const maxPct = 100;
  const chartHeight = 100;

  return (
    <View>
      <View style={[styles.lineChartArea, { height: chartHeight }]}>
        {data.map((point, i) => {
          const xPct = data.length > 1 ? (i / (data.length - 1)) * 100 : 50;
          const yPct = point.pct != null ? (point.pct / maxPct) * 100 : 0;
          return (
            <View
              key={point.label}
              style={[
                styles.lineDot,
                {
                  left: `${xPct}%`,
                  bottom: `${yPct}%`,
                  backgroundColor: point.pct != null ? accentColor : mutedColor,
                  opacity: point.pct != null ? 1 : 0.35,
                },
              ]}
            />
          );
        })}
        {validPoints.length > 1 &&
          validPoints.map((point, i) => {
            if (i === 0) return null;
            const prev = validPoints[i - 1];
            const prevIdx = data.findIndex((d) => d.label === prev.label);
            const currIdx = data.findIndex((d) => d.label === point.label);
            const x1 = data.length > 1 ? (prevIdx / (data.length - 1)) * 100 : 50;
            const x2 = data.length > 1 ? (currIdx / (data.length - 1)) * 100 : 50;
            const y1 = (prev.pct! / maxPct) * 100;
            const y2 = (point.pct! / maxPct) * 100;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            return (
              <View
                key={`line-${point.label}`}
                style={[
                  styles.lineSegment,
                  {
                    left: `${x1}%`,
                    bottom: `${y1}%`,
                    width: `${length}%`,
                    transform: [{ rotate: `${angle}deg` }],
                    backgroundColor: accentColor,
                  },
                ]}
              />
            );
          })}
      </View>
      <View style={styles.lineLabels}>
        {data.map((point) => (
          <Text key={point.label} style={[styles.lineLabel, { color: mutedColor }]}>
            {point.label}
          </Text>
        ))}
      </View>
      <Text style={[styles.lineCaption, { color: textColor }]}>
        {validPoints.length === 0
          ? "Log shooting drills to see your trend"
          : `Latest: ${validPoints[validPoints.length - 1].pct}%`}
      </Text>
    </View>
  );
}

function CategoryShootingSection({
  categories,
  colors,
}: {
  categories: CategoryStats[];
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const withShooting = categories.filter((c) => c.attempts > 0);
  if (withShooting.length === 0) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Complete shooting drills to see category breakdown.
      </Text>
    );
  }
  const maxPct = Math.max(...withShooting.map((c) => c.shootingPct ?? 0), 1);
  return (
    <View style={{ gap: 12 }}>
      {withShooting.map((cat) => (
        <HorizontalBar
          key={cat.category}
          label={cat.label}
          value={cat.shootingPct ?? 0}
          max={maxPct}
          color={colors.accent}
          suffix="%"
          mutedColor={colors.textSecondary}
        />
      ))}
    </View>
  );
}

function MakesMissesSection({
  makes,
  misses,
  colors,
}: {
  makes: number;
  misses: number;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const total = makes + misses;
  if (total === 0) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Your makes and misses will appear here as you log shooting drills.
      </Text>
    );
  }
  const makesPct = (makes / total) * 100;
  const missesPct = (misses / total) * 100;
  return (
    <View>
      <View style={styles.makesMissesBar}>
        <View style={[styles.makesSegment, { width: `${makesPct}%`, backgroundColor: colors.success }]} />
        <View style={[styles.missesSegment, { width: `${missesPct}%`, backgroundColor: colors.danger }]} />
      </View>
      <View style={styles.makesMissesLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.legendText, { color: colors.text }]}>{makes} makes</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
          <Text style={[styles.legendText, { color: colors.text }]}>{misses} misses</Text>
        </View>
      </View>
    </View>
  );
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

  const maxMinutes = Math.max(...summary.weeklyProgress.map((w) => w.minutes), 1);

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
          Track shooting, volume, and skill progress from your logged workouts.
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

        <View style={styles.rowGrid}>
          <Card style={styles.skillCard}>
            <Text style={[styles.skillLabel, { color: colors.textMuted }]}>Strongest</Text>
            <Text style={[styles.skillValue, { color: colors.success }]}>
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
          <Text style={[styles.chartTitle, { color: colors.text }]}>Makes vs Misses</Text>
          <MakesMissesSection makes={summary.totalMakes} misses={summary.totalMisses} colors={colors} />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Shooting % by Category</Text>
          <CategoryShootingSection categories={summary.categoryStats} colors={colors} />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Weekly Shooting Trend</Text>
          <LineTrendChart
            data={summary.weeklyShooting.map((w) => ({ label: w.label, pct: w.pct }))}
            accentColor={colors.accent}
            mutedColor={colors.textMuted}
            textColor={colors.textSecondary}
          />
        </Card>

        <Card style={styles.chartCard}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>Training Volume</Text>
          <View style={styles.chartRow}>
            {summary.weeklyProgress.map((week) => (
              <View key={week.label} style={styles.chartBarWrapper}>
                <Text style={[styles.barTopLabel, { color: colors.textMuted }]}>
                  {week.minutes > 0 ? week.minutes : ""}
                </Text>
                <View style={styles.chartBarTrack}>
                  <View
                    style={[
                      styles.chartBar,
                      {
                        height: `${Math.max((week.minutes / maxMinutes) * 100, week.minutes > 0 ? 8 : 4)}%`,
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.chartBarLabel, { color: colors.textMuted }]}>{week.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {summary.categoryStats.length > 0 && (
          <Card style={styles.chartCard}>
            <Text style={[styles.chartTitle, { color: colors.text }]}>Drill Completion by Category</Text>
            <View style={{ gap: 12, marginTop: 4 }}>
              {summary.categoryStats.map((cat) => (
                <HorizontalBar
                  key={`completion-${cat.category}`}
                  label={cat.label}
                  value={cat.drillsCompleted}
                  max={Math.max(...summary.categoryStats.map((c) => c.drillsTotal), 1)}
                  color={colors.success}
                  suffix={`/${cat.drillsTotal}`}
                  mutedColor={colors.textSecondary}
                />
              ))}
            </View>
          </Card>
        )}

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
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 130,
  },
  chartBarWrapper: {
    flex: 1,
    alignItems: "center",
    height: "100%",
    justifyContent: "flex-end",
  },
  chartBarTrack: {
    flex: 1,
    width: 22,
    justifyContent: "flex-end",
  },
  chartBar: {
    width: "100%",
    borderRadius: 8,
    minHeight: 4,
  },
  chartBarLabel: {
    fontSize: 10,
    marginTop: 6,
    fontWeight: "600",
  },
  barTopLabel: {
    fontSize: 9,
    fontWeight: "700",
    marginBottom: 4,
    minHeight: 12,
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
  hBarRow: {
    gap: 6,
  },
  hBarLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  hBarTrackWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  hBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
  },
  hBarFill: {
    height: "100%",
    borderRadius: 5,
  },
  hBarValue: {
    fontSize: 12,
    fontWeight: "800",
    minWidth: 44,
    textAlign: "right",
  },
  makesMissesBar: {
    flexDirection: "row",
    height: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  makesSegment: {
    height: "100%",
  },
  missesSegment: {
    height: "100%",
  },
  makesMissesLegend: {
    flexDirection: "row",
    gap: 20,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 13,
    fontWeight: "600",
  },
  lineChartArea: {
    position: "relative",
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.3)",
  },
  lineDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    marginBottom: -5,
  },
  lineSegment: {
    position: "absolute",
    height: 2,
    transformOrigin: "left center",
  },
  lineLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  lineLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  lineCaption: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },
});
