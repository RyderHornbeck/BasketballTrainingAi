import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  AnalyticsPeriod,
  CompletionTrendPoint,
  HeatmapPoint,
  ShootingBucket,
} from "@/lib/analytics";
import Heatmap from "@rific/heatmap";
import React, { useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import { BarChart, LineChart } from "react-native-gifted-charts";

const SHOTS_PER_LINE = 5;
const SEGMENT_GAP = 2;
const CHART_HEIGHT = 190;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_WIDTH = SCREEN_WIDTH - 76;

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  alltime: "All Time",
};

const MISS_GREY = { dark: "#636366", light: "#AEAEB2" };

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

function chunkShots(total: number): number[] {
  const chunks: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    chunks.push(Math.min(SHOTS_PER_LINE, remaining));
    remaining -= SHOTS_PER_LINE;
  }
  return chunks;
}

function buildSegmentedStacks(
  makes: number,
  misses: number,
  makeColor: string,
  missColor: string
) {
  const stacks: { value: number; color: string; marginBottom?: number }[] = [];

  const makeChunks = chunkShots(makes);
  makeChunks.forEach((value, index) => {
    const isLastMake = index === makeChunks.length - 1;
    stacks.push({
      value,
      color: makeColor,
      marginBottom: !isLastMake ? SEGMENT_GAP : misses > 0 ? SEGMENT_GAP : 0,
    });
  });

  const missChunks = chunkShots(misses);
  missChunks.forEach((value, index) => {
    stacks.push({
      value,
      color: missColor,
      marginBottom: index < missChunks.length - 1 ? SEGMENT_GAP : 0,
    });
  });

  return stacks;
}

function maxStackTotal(buckets: ShootingBucket[]): number {
  const peak = Math.max(...buckets.map((b) => b.makes + b.misses), SHOTS_PER_LINE);
  return Math.ceil(peak / SHOTS_PER_LINE) * SHOTS_PER_LINE || SHOTS_PER_LINE;
}

export function MakesMissesBarChart({ buckets }: { buckets: ShootingBucket[] }) {
  const { colors, scheme } = useTheme();
  const missColor = scheme === "dark" ? MISS_GREY.dark : MISS_GREY.light;

  const stackData = useMemo(
    () =>
      buckets.map((bucket) => ({
        label: bucket.label,
        spacing: 18,
        stacks: buildSegmentedStacks(bucket.makes, bucket.misses, colors.accent, missColor),
      })),
    [buckets, colors.accent, missColor]
  );

  const hasData = buckets.some((b) => b.makes > 0 || b.misses > 0);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting drills to see makes and misses over time.
      </Text>
    );
  }

  const chartMax = maxStackTotal(buckets);
  const barCount = buckets.length;

  return (
    <View>
      <BarChart
        stackData={stackData}
        width={Math.max(CHART_WIDTH, barCount * 52)}
        height={CHART_HEIGHT}
        barWidth={28}
        maxValue={chartMax}
        noOfSections={4}
        isAnimated
        animationDuration={600}
        stackBorderTopLeftRadius={4}
        stackBorderTopRightRadius={4}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        rulesColor={colors.border}
        yAxisColor="transparent"
        xAxisColor={colors.border}
        initialSpacing={16}
        spacing={18}
      />
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Makes (5 shots per line)
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: missColor }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Misses</Text>
        </View>
      </View>
    </View>
  );
}

function useGradientLineProps() {
  const { colors } = useTheme();
  return {
    areaChart: true as const,
    curved: true as const,
    isAnimated: true as const,
    animationDuration: 700,
    height: CHART_HEIGHT,
    width: CHART_WIDTH,
    thickness: 3,
    color: colors.accent,
    startFillColor: colors.accent,
    endFillColor: colors.background,
    startOpacity: 0.38,
    endOpacity: 0.03,
    gradientDirection: "vertical" as const,
    dataPointsColor: colors.accent,
    dataPointsRadius: 4,
    hideDataPoints: false,
    noOfSections: 4,
    yAxisTextStyle: { color: colors.textMuted, fontSize: 10 },
    xAxisLabelTextStyle: { color: colors.textMuted, fontSize: 10 },
    rulesColor: colors.border,
    yAxisColor: "transparent",
    xAxisColor: colors.border,
    initialSpacing: 20,
    spacing: Math.max(36, CHART_WIDTH / 8),
  };
}

export function CompletionLineChart({ points }: { points: CompletionTrendPoint[] }) {
  const { colors } = useTheme();
  const lineProps = useGradientLineProps();

  const data = useMemo(
    () =>
      points.map((point) => ({
        value: point.rate,
        label: point.label,
        dataPointText: `${point.rate}%`,
      })),
    [points]
  );

  const hasData = points.some((p) => p.rate > 0);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Finish workouts to track your plan completion rate over time.
      </Text>
    );
  }

  return (
    <View>
      <LineChart {...lineProps} data={data} maxValue={100} formatYLabel={(v) => `${v}%`} />
      <Text style={[styles.caption, { color: colors.textMuted }]}>
        Cumulative plan completion by week
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
  const lineProps = useGradientLineProps();

  const data = useMemo(
    () =>
      buckets.map((bucket) => ({
        value: bucket.pct ?? 0,
        label: bucket.label,
        dataPointText: bucket.pct != null ? `${bucket.pct}%` : "",
      })),
    [buckets]
  );

  const hasData = buckets.some((b) => b.pct != null);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting drills to see your weekly shooting trend.
      </Text>
    );
  }

  return <LineChart {...lineProps} data={data} maxValue={100} formatYLabel={(v) => `${v}%`} />;
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
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
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
