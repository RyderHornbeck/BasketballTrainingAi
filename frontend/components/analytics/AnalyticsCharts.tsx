import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  AnalyticsPeriod,
  CompletionTrendPoint,
  HeatmapPoint,
  ShootingBucket,
} from "@/lib/analytics";
import { Poppins_500Medium, Poppins_600SemiBold } from "@expo-google-fonts/poppins";
import { useFont } from "@shopify/react-native-skia";
import Heatmap from "@rific/heatmap";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CartesianChart, Line, BarGroup } from "victory-native";

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  alltime: "All Time",
};

export function PeriodSelector({
  value,
  onChange,
}: {
  value: AnalyticsPeriod;
  onChange: (period: AnalyticsPeriod) => void;
}) {
  const { colors } = useTheme();
  const periods: AnalyticsPeriod[] = ["daily", "weekly", "monthly", "alltime"];

  return (
    <View style={styles.periodRow}>
      {periods.map((period) => {
        const selected = period === value;
        return (
          <Pressable
            key={period}
            onPress={() => onChange(period)}
            style={[
              styles.periodPill,
              {
                backgroundColor: selected ? colors.accent : colors.cardAlt,
                borderColor: selected ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.periodPillText,
                { color: selected ? "#FFFFFF" : colors.textSecondary },
              ]}
            >
              {PERIOD_LABELS[period]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type ChartDatum = {
  x: number;
  makes: number;
  misses: number;
  label: string;
};

function toChartData(buckets: ShootingBucket[]): ChartDatum[] {
  return buckets.map((bucket, index) => ({
    x: index,
    makes: bucket.makes,
    misses: bucket.misses,
    label: bucket.label,
  }));
}

export function MakesMissesBarChart({ buckets }: { buckets: ShootingBucket[] }) {
  const { colors } = useTheme();
  const font = useFont(Poppins_500Medium, 10);
  const data = useMemo(() => toChartData(buckets), [buckets]);
  const labelByX = useMemo(
    () => Object.fromEntries(data.map((point) => [point.x, point.label])),
    [data]
  );

  const hasData = buckets.some((b) => b.makes > 0 || b.misses > 0);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting drills to see makes and misses over time.
      </Text>
    );
  }

  if (!font) {
    return <View style={styles.chartPlaceholder} />;
  }

  return (
    <View style={styles.chartBox}>
      <CartesianChart
        data={data}
        xKey="x"
        yKeys={["makes", "misses"]}
        domainPadding={{ left: 24, right: 24, top: 20 }}
        axisOptions={{
          font,
          tickCount: { x: data.length, y: 4 },
          formatXLabel: (value) => labelByX[value] ?? "",
          labelColor: colors.textMuted,
          lineColor: colors.border,
        }}
      >
        {({ points, chartBounds }) => (
          <BarGroup
            chartBounds={chartBounds}
            betweenGroupPadding={0.35}
            withinGroupPadding={0.15}
            roundedCorners={{ topLeft: 6, topRight: 6 }}
          >
            <BarGroup.Bar points={points.makes} color={colors.accent} />
            <BarGroup.Bar points={points.misses} color={colors.danger} />
          </BarGroup>
        )}
      </CartesianChart>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Makes</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Misses</Text>
        </View>
      </View>
    </View>
  );
}

type TrendDatum = {
  x: number;
  rate: number;
  label: string;
};

export function CompletionLineChart({ points }: { points: CompletionTrendPoint[] }) {
  const { colors } = useTheme();
  const font = useFont(Poppins_500Medium, 10);
  const data = useMemo<TrendDatum[]>(
    () =>
      points.map((point, index) => ({
        x: index,
        rate: point.rate,
        label: point.label,
      })),
    [points]
  );
  const labelByX = useMemo(
    () => Object.fromEntries(data.map((point) => [point.x, point.label])),
    [data]
  );

  const hasData = points.some((p) => p.rate > 0);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Finish workouts to track your plan completion rate over time.
      </Text>
    );
  }

  if (!font) {
    return <View style={styles.chartPlaceholder} />;
  }

  return (
    <View style={styles.chartBox}>
      <CartesianChart
        data={data}
        xKey="x"
        yKeys={["rate"]}
        domain={{ y: [0, 100] }}
        domainPadding={{ left: 24, right: 24, top: 20 }}
        axisOptions={{
          font,
          tickCount: { x: data.length, y: 5 },
          formatXLabel: (value) => labelByX[value] ?? "",
          formatYLabel: (value) => `${value}%`,
          labelColor: colors.textMuted,
          lineColor: colors.border,
        }}
      >
        {({ points }) => (
          <Line
            points={points.rate}
            color={colors.accent}
            strokeWidth={3}
            curveType="natural"
            animate={{ type: "spring" }}
          />
        )}
      </CartesianChart>
      <Text style={[styles.caption, { color: colors.textMuted }]}>
        Cumulative plan completion by week
      </Text>
    </View>
  );
}

export function WorkoutActivityHeatmap({ data }: { data: HeatmapPoint[] }) {
  const { colors, scheme } = useTheme();

  if (data.length === 0) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Your training activity will light up here after you complete workouts.
      </Text>
    );
  }

  const orangeScale = {
    thresholds: [15, 30, 45, 60],
    colors: [
      scheme === "dark" ? "#2A2A2D" : "#EBEBF0",
      "rgba(255,122,26,0.25)",
      "rgba(255,122,26,0.45)",
      "rgba(255,122,26,0.7)",
      colors.accent,
    ],
    emptyColor: scheme === "dark" ? "#2A2A2D" : "#EBEBF0",
  };

  return (
    <View style={styles.heatmapWrap}>
      <Heatmap.Calendar
        data={data}
        animated
        colorScale={orangeScale}
        colorScheme={scheme}
        scrollEnabled
        tooltipLabel="min"
        tooltipEmptyLabel="Rest day"
        theme={{
          backgroundColor: "transparent",
          monthLabelColor: colors.textMuted,
          dayLabelColor: colors.textMuted,
          todayBorderColor: colors.accent,
          tooltipBackgroundColor: scheme === "dark" ? "#1C1C1E" : "#111113",
          tooltipTextColor: "#FFFFFF",
        }}
      />
      <Text style={[styles.caption, { color: colors.textMuted }]}>
        Darker orange = more training minutes that day
      </Text>
    </View>
  );
}

export function ShootingTrendLineChart({
  buckets,
}: {
  buckets: { label: string; pct: number | null }[];
}) {
  const { colors } = useTheme();
  const font = useFont(Poppins_600SemiBold, 10);
  const data = useMemo(
    () =>
      buckets.map((bucket, index) => ({
        x: index,
        pct: bucket.pct ?? 0,
        label: bucket.label,
        hasData: bucket.pct != null,
      })),
    [buckets]
  );
  const labelByX = useMemo(
    () => Object.fromEntries(data.map((point) => [point.x, point.label])),
    [data]
  );

  const hasData = buckets.some((b) => b.pct != null);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting drills to see your weekly shooting trend.
      </Text>
    );
  }

  if (!font) {
    return <View style={styles.chartPlaceholder} />;
  }

  return (
    <View style={styles.chartBox}>
      <CartesianChart
        data={data}
        xKey="x"
        yKeys={["pct"]}
        domain={{ y: [0, 100] }}
        domainPadding={{ left: 24, right: 24, top: 20 }}
        axisOptions={{
          font,
          tickCount: { x: data.length, y: 5 },
          formatXLabel: (value) => labelByX[value] ?? "",
          formatYLabel: (value) => `${value}%`,
          labelColor: colors.textMuted,
          lineColor: colors.border,
        }}
      >
        {({ points }) => (
          <Line
            points={points.pct}
            color={colors.accent}
            strokeWidth={3}
            curveType="natural"
            animate={{ type: "spring" }}
          />
        )}
      </CartesianChart>
    </View>
  );
}

const styles = StyleSheet.create({
  periodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  periodPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  periodPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  chartBox: {
    height: 220,
    width: "100%",
  },
  chartPlaceholder: {
    height: 220,
    width: "100%",
  },
  legendRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 10,
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
    fontSize: 12,
    fontWeight: "600",
  },
  caption: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },
  heatmapWrap: {
    marginHorizontal: -4,
  },
});
