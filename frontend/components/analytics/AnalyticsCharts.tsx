import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  AnalyticsPeriod,
  CompletionTrendPoint,
  HeatmapPoint,
  ShootingBucket,
} from "@/lib/analytics";
import { SkillProfile } from "@/lib/skillRatings";
import React, { useMemo } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

const SHOTS_PER_LINE = 5;
const SEGMENT_GAP = 2;
const CHART_HEIGHT = 180;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_WIDTH = SCREEN_WIDTH - 76;

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  alltime: "All Time",
};

const SKILL_LABELS: Record<string, string> = {
  shooting: "Shooting",
  ball_handling: "Handle",
  finishing: "Finishing",
  defense: "Defense",
  conditioning: "Cond",
  basketball_iq: "IQ",
};

const COMPACT_SKILL_LABELS: Record<string, string> = {
  shooting: "Shoot",
  ball_handling: "Handle",
  finishing: "Finish",
  defense: "Def",
  conditioning: "Cond",
  basketball_iq: "IQ",
};

const FINISHING_BLUE = { dark: "#5AC8FA", light: "#007AFF" };

const MISS_GREY = { dark: "#636366", light: "#AEAEB2" };

function polarPoint(
  centerX: number,
  centerY: number,
  radius: number,
  axisIndex: number,
  axisCount: number,
  value: number
) {
  const angle = (Math.PI * 2 * axisIndex) / axisCount - Math.PI / 2;
  const distance = radius * (clamp(value, 0, 100) / 100);
  return {
    x: centerX + distance * Math.cos(angle),
    y: centerY + distance * Math.sin(angle),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function SkillRadarChart({
  profile,
  compact = false,
}: {
  profile: SkillProfile;
  compact?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const size = compact ? 196 : CHART_WIDTH;
  const pad = compact ? 18 : 28;
  const svgSize = size + pad * 2;
  const center = svgSize / 2;
  const radius = size * (compact ? 0.3 : 0.28);
  const labelRadius = radius + (compact ? 16 : 24);
  const skills = profile.skills;
  const axisCount = skills.length;

  const polygonPoints = useMemo(() => {
    const pts = skills.map((skill, index) => {
      const point = polarPoint(center, center, radius, index, axisCount, skill.score);
      return `${point.x},${point.y}`;
    });
    if (pts.length === 0) return "";
    return `${pts.join(" ")} ${pts[0]}`;
  }, [skills, center, radius, axisCount]);

  const gridColor = scheme === "dark" ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)";
  const gridStroke = compact ? 1.25 : 1.5;
  const fillColor = scheme === "dark" ? "rgba(255,122,26,0.28)" : "rgba(255,122,26,0.22)";

  return (
    <View style={[styles.radarWrap, compact && styles.radarWrapCompact]}>
      {!compact ? (
        <View style={styles.radarHeader}>
          <View>
            <Text style={[styles.radarEyebrow, { color: colors.textSecondary }]}>Overall Rating</Text>
            <Text style={[styles.radarOverall, { color: colors.text }]}>{profile.overall}</Text>
          </View>
          <Text style={[styles.radarCaption, { color: colors.textMuted }]}>
            Starts from onboarding, then slowly shifts as you log workouts. One great set barely moves
            the needle — consistent improvement does.
          </Text>
        </View>
      ) : null}

      <Svg width={svgSize} height={svgSize} style={{ marginHorizontal: -pad }}>
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const ringPts = skills.map((_, index) =>
            polarPoint(center, center, radius * fraction, index, axisCount, 100)
          );
          const closedRing = [...ringPts, ringPts[0]]
            .map((p) => `${p.x},${p.y}`)
            .join(" ");
          return (
            <Polyline
              key={fraction}
              points={closedRing}
              fill="none"
              stroke={gridColor}
              strokeWidth={gridStroke}
            />
          );
        })}

        {skills.map((_, index) => {
          const end = polarPoint(center, center, radius, index, axisCount, 100);
          return (
            <Line
              key={`axis-${index}`}
              x1={center}
              y1={center}
              x2={end.x}
              y2={end.y}
              stroke={gridColor}
              strokeWidth={gridStroke}
            />
          );
        })}

        <Polyline points={polygonPoints} fill={fillColor} stroke={colors.accent} strokeWidth={2.5} />

        {skills.map((skill, index) => {
          const point = polarPoint(center, center, radius, index, axisCount, skill.score);
          return (
            <Circle
              key={skill.key}
              cx={point.x}
              cy={point.y}
              r={compact ? 3 : 4}
              fill={colors.accent}
            />
          );
        })}

        {compact ? (
          <>
            <SvgText
              x={center}
              y={center - 6}
              fill={colors.textSecondary}
              fontSize={9}
              fontWeight="600"
              textAnchor="middle"
            >
              Overall
            </SvgText>
            <SvgText
              x={center}
              y={center + 12}
              fill={colors.text}
              fontSize={18}
              fontWeight="800"
              textAnchor="middle"
            >
              {profile.overall}
            </SvgText>
          </>
        ) : null}

        {skills.map((skill, index) => {
          const angle = (Math.PI * 2 * index) / axisCount - Math.PI / 2;
          const x = center + labelRadius * Math.cos(angle);
          const y = center + labelRadius * Math.sin(angle);
          const anchor =
            Math.abs(Math.cos(angle)) < 0.25 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
          const label = compact
            ? (COMPACT_SKILL_LABELS[skill.key] ?? skill.label)
            : (SKILL_LABELS[skill.key] ?? skill.label);
          return (
            <React.Fragment key={`${skill.key}-label`}>
              <SvgText
                x={x}
                y={y - 2}
                fill={colors.textSecondary}
                fontSize={compact ? 8 : 9}
                fontWeight="600"
                textAnchor={anchor}
              >
                {label}
              </SvgText>
              <SvgText
                x={x}
                y={y + (compact ? 9 : 10)}
                fill={colors.text}
                fontSize={compact ? 9 : 10}
                fontWeight="700"
                textAnchor={anchor}
              >
                {skill.score}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

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
  const padded = Math.ceil(peak * 1.08);
  return Math.ceil(padded / SHOTS_PER_LINE) * SHOTS_PER_LINE || SHOTS_PER_LINE;
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

  const totalMakes = buckets.reduce((sum, b) => sum + b.makes, 0);
  const totalMisses = buckets.reduce((sum, b) => sum + b.misses, 0);
  const chartMax = maxStackTotal(buckets);
  const barWidth = 18;
  const barGap = 12;
  const chartInnerWidth = Math.max(CHART_WIDTH, buckets.length * (barWidth + barGap) + 40);
  const plotHeight = CHART_HEIGHT - 36;
  const leftPad = 28;
  const segmentUnit = plotHeight / chartMax;

  return (
    <View>
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total</Text>
        <Text style={[styles.totalMakes, { color: colors.accent }]}>{totalMakes}</Text>
        <Text style={[styles.totalMisses, { color: missColor }]}>{totalMisses}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={chartInnerWidth} height={CHART_HEIGHT}>
          {[0, 0.5, 1].map((fraction) => {
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
            const makeSegments = chunkShots(bucket.makes).map((value) => ({
              value,
              color: colors.accent,
            }));
            const missSegments = chunkShots(bucket.misses).map((value) => ({
              value,
              color: missColor,
            }));
            const segments = [...makeSegments, ...missSegments];

            return (
              <React.Fragment key={bucket.label}>
                {segments.map((segment, segmentIndex) => {
                  const extraGap =
                    segmentIndex === makeSegments.length && missSegments.length > 0
                      ? SEGMENT_GAP * 2
                      : 0;
                  const height = Math.max(2, segment.value * segmentUnit - SEGMENT_GAP);
                  stackTop -= extraGap + height + SEGMENT_GAP;
                  return (
                    <Rect
                      key={`${bucket.label}-${segmentIndex}`}
                      x={x}
                      y={stackTop}
                      width={barWidth}
                      height={height}
                      rx={2}
                      fill={segment.color}
                    />
                  );
                })}
                <SvgText
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 6}
                  fill={colors.textMuted}
                  fontSize={9}
                  textAnchor="middle"
                >
                  {bucket.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

function SimpleLineChart({
  data,
  maxValue,
  formatLabel,
  caption,
}: {
  data: { label: string; value: number }[];
  maxValue: number;
  formatLabel?: (value: number) => string;
  caption?: string;
}) {
  const { colors } = useTheme();
  const plotHeight = CHART_HEIGHT - 40;
  const leftPad = 34;
  const rightPad = 12;
  const topPad = 12;
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
        {[0, 0.5, 1].map((fraction) => {
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
    () => points.map((point) => ({ value: point.rate, label: point.label })),
    [points]
  );

  if (!points.some((p) => p.rate > 0)) {
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
  buckets: { label: string; shootingPct: number | null; finishingPct: number | null }[];
}) {
  const { colors, scheme } = useTheme();
  const finishingColor = scheme === "dark" ? FINISHING_BLUE.dark : FINISHING_BLUE.light;

  const hasShooting = buckets.some((b) => b.shootingPct != null);
  const hasFinishing = buckets.some((b) => b.finishingPct != null);

  if (!hasShooting && !hasFinishing) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Log shooting and finishing drills to see your percentage trends.
      </Text>
    );
  }

  const plotHeight = CHART_HEIGHT - 48;
  const leftPad = 34;
  const rightPad = 12;
  const topPad = 12;
  const usableWidth = CHART_WIDTH - leftPad - rightPad;
  const step = buckets.length > 1 ? usableWidth / (buckets.length - 1) : 0;
  const maxValue = 100;

  const shootingPoints = buckets.map((point, index) => {
    const x = leftPad + index * step;
    const value = point.shootingPct ?? 0;
    const y = topPad + plotHeight - (value / maxValue) * plotHeight;
    return { x, y, label: point.label, value: point.shootingPct };
  });

  const finishingPoints = buckets.map((point, index) => {
    const x = leftPad + index * step;
    const value = point.finishingPct ?? 0;
    const y = topPad + plotHeight - (value / maxValue) * plotHeight;
    return { x, y, label: point.label, value: point.finishingPct };
  });

  const shootingLine = shootingPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const finishingLine = finishingPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Shooting</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: finishingColor }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Finishing</Text>
        </View>
      </View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((fraction) => {
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
                {`${value}%`}
              </SvgText>
            </React.Fragment>
          );
        })}
        {hasFinishing ? (
          <Polyline
            points={finishingLine}
            fill="none"
            stroke={finishingColor}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {hasShooting ? (
          <Polyline
            points={shootingLine}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {shootingPoints
          .filter((p) => p.value != null)
          .map((point) => (
            <Circle key={`shoot-${point.label}`} cx={point.x} cy={point.y} r={3.5} fill={colors.accent} />
          ))}
        {finishingPoints
          .filter((p) => p.value != null)
          .map((point) => (
            <Circle key={`finish-${point.label}`} cx={point.x} cy={point.y} r={3.5} fill={finishingColor} />
          ))}
        {buckets.map((point, index) => (
          <SvgText
            key={`${point.label}-label`}
            x={leftPad + index * step}
            y={CHART_HEIGHT - 8}
            fill={colors.textMuted}
            fontSize={10}
            textAnchor="middle"
          >
            {point.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

function heatColor(value: number, scheme: "light" | "dark", accent: string): string {
  if (value <= 0) return scheme === "dark" ? "#2A2A2D" : "#EBEBF0";
  if (value < 30) return scheme === "dark" ? "#5C3D24" : "#FFD9BF";
  if (value < 60) return scheme === "dark" ? "#B86E22" : "#FF8F3D";
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
  radarWrap: {
    alignItems: "center",
  },
  radarWrapCompact: {
    alignItems: "flex-end",
    justifyContent: "center",
    flex: 1,
  },
  radarHeader: {
    width: "100%",
    marginBottom: 8,
    gap: 10,
  },
  radarEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  radarOverall: {
    fontSize: 42,
    fontWeight: "800",
    lineHeight: 46,
    marginTop: 2,
  },
  radarCaption: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  totalMakes: {
    fontSize: 22,
    fontWeight: "800",
  },
  totalMisses: {
    fontSize: 22,
    fontWeight: "800",
  },
  legendRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 6,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
