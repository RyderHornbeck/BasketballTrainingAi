import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  AnalyticsPeriod,
  CompletionTrendPoint,
  HeatmapPoint,
  ShootingBucket,
} from "@/lib/analytics";
import React, { useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

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

function maxStackTotal(buckets: ShootingBucket[]): number {
  const peak = Math.max(...buckets.map((b) => b.makes + b.misses), SHOTS_PER_LINE);
  return Math.ceil(peak / SHOTS_PER_LINE) * SHOTS_PER_LINE || SHOTS_PER_LINE;
}

export function MakesMissesBarChart({ buckets }: { buckets: ShootingBucket[] }) {
  const { colors, scheme } = useTheme();
  const missColor = scheme === "dark" ? MISS_GREY.dark : MISS_GREY.light;

  const hasData = buckets.some((b) => b.makes > 0 || b.misses > 0);
  if (!hasData) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting drills to see makes and misses over time.
      </Text>
    );
  }

  const chartMax = maxStackTotal(buckets);
  const barWidth = 28;
  const barGap = 18;
  const chartInnerWidth = Math.max(CHART_WIDTH, buckets.length * (barWidth + barGap) + 32);
  const plotHeight = CHART_HEIGHT - 36;
  const leftPad = 28;
  const bottomPad = 28;

  return (
    <View>
      <Svg width={chartInnerWidth} height={CHART_HEIGHT}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = plotHeight - fraction * plotHeight + 8;
          const value = Math.round(chartMax * fraction);
          return (
            <React.Fragment key={fraction}>
              <Line
                x1={leftPad}
                y1={y}
                x2={chartInnerWidth - 8}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
              />
              <SvgText x={4} y={y + 4} fill={colors.textMuted} fontSize={10}>
                {value}
              </SvgText>
            </React.Fragment>
          );
        })}

        {buckets.map((bucket, bucketIndex) => {
          const x = leftPad + bucketIndex * (barWidth + barGap) + 8;
          let stackTop = plotHeight + 8;
          const makeChunks = chunkShots(bucket.makes);
          const missChunks = chunkShots(bucket.misses);
          const segments = [
            ...makeChunks.map((value) => ({ value, color: colors.accent })),
            ...missChunks.map((value) => ({ value, color: missColor })),
          ];

          return (
            <React.Fragment key={bucket.label}>
              {segments.map((segment, segmentIndex) => {
                const height = (segment.value / chartMax) * plotHeight;
                stackTop -= height;
                const rectY = stackTop;
                if (segmentIndex < segments.length - 1) {
                  stackTop -= SEGMENT_GAP;
                }
                return (
                  <Rect
                    key={`${bucket.label}-${segmentIndex}`}
                    x={x}
                    y={rectY}
                    width={barWidth}
                    height={height}
                    rx={4}
                    fill={segment.color}
                  />
                );
              })}
              <SvgText
                x={x + barWidth / 2}
                y={CHART_HEIGHT - 6}
                fill={colors.textMuted}
                fontSize={10}
                textAnchor="middle"
              >
                {bucket.label}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
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

function SimpleLineChart({
  data,
  maxValue,
  formatLabel,
  caption,
}: {
  data: { label: string; value: number; dataPointText?: string }[];
  maxValue: number;
  formatLabel?: (value: number) => string;
  caption?: string;
}) {
  const { colors } = useTheme();
  const plotHeight = CHART_HEIGHT - 40;
  const leftPad = 34;
  const rightPad = 12;
  const topPad = 12;
  const bottomPad = 28;
  const usableWidth = CHART_WIDTH - leftPad - rightPad;
  const step = data.length > 1 ? usableWidth / (data.length - 1) : 0;

  const points = data.map((point, index) => {
    const x = leftPad + index * step;
    const y = topPad + plotHeight - (point.value / maxValue) * plotHeight;
    return { ...point, x, y };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = topPad + plotHeight - fraction * plotHeight;
          const value = Math.round(maxValue * fraction);
          return (
            <React.Fragment key={fraction}>
              <Line
                x1={leftPad}
                y1={y}
                x2={CHART_WIDTH - rightPad}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
              />
              <SvgText x={4} y={y + 4} fill={colors.textMuted} fontSize={10}>
                {formatLabel ? formatLabel(value) : String(value)}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Polyline
          points={polyline}
          fill="none"
          stroke={colors.accent}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point) => (
          <Circle key={point.label} cx={point.x} cy={point.y} r={4} fill={colors.accent} />
        ))}
        {points.map((point) => (
          <SvgText
            key={`${point.label}-label`}
            x={point.x}
            y={CHART_HEIGHT - 8}
            fill={colors.textMuted}
            fontSize={10}
            textAnchor="middle"
          >
            {point.label}
          </SvgText>
        ))}
      </Svg>
      {caption ? (
        <Text style={[styles.caption, { color: colors.textMuted }]}>{caption}</Text>
      ) : null}
    </View>
  );
}

export function CompletionLineChart({ points }: { points: CompletionTrendPoint[] }) {
  const { colors } = useTheme();
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
    <SimpleLineChart
      data={data}
      maxValue={100}
      formatLabel={(value) => `${value}%`}
      caption="Cumulative plan completion by week"
    />
  );
}

export function ShootingTrendLineChart({
  buckets,
}: {
  buckets: { label: string; pct: number | null }[];
}) {
  const { colors } = useTheme();
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

  return <SimpleLineChart data={data} maxValue={100} formatLabel={(value) => `${value}%`} />;
}

function heatColor(value: number, scheme: "light" | "dark", accent: string): string {
  if (value <= 0) return scheme === "dark" ? "#2A2A2D" : "#EBEBF0";
  if (value < 15) return scheme === "dark" ? "#5C3D24" : "#FFD9BF";
  if (value < 30) return scheme === "dark" ? "#8A5528" : "#FFB880";
  if (value < 45) return scheme === "dark" ? "#B86E22" : "#FF8F3D";
  if (value < 60) return accent;
  return accent;
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

  const cellSize = 12;
  const cellGap = 3;
  const weeks = 12;
  const daysPerWeek = 7;
  const recent = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-weeks * daysPerWeek);
  const padded = Array.from({ length: weeks * daysPerWeek }, (_, index) => {
    const point = recent[index];
    return { date: point?.date ?? "", value: point?.value ?? 0 };
  });

  return (
    <View style={styles.heatmapWrap}>
      <View style={styles.heatmapGrid}>
        {padded.map((point, index) => (
          <View
            key={`${point.date}-${index}`}
            style={[
              styles.heatmapCell,
              {
                width: cellSize,
                height: cellSize,
                marginRight: (index + 1) % daysPerWeek === 0 ? 0 : cellGap,
                marginBottom: cellGap,
                backgroundColor: heatColor(point.value, scheme, colors.accent),
              },
            ]}
          />
        ))}
      </View>
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
  heatmapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 7 * 15,
  },
  heatmapCell: {
    borderRadius: 2,
  },
});
