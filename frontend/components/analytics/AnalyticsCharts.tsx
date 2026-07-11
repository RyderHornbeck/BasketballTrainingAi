import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  CompletionTrendPoint,
  HeatmapPoint,
} from "@/lib/analytics";
import {
  ShootingBucket,
  ShootingChartPeriod,
  ShootingLogEntry,
  buildAllTimeBuckets,
  buildMonthlyBuckets,
  buildWeeklyBuckets,
  canGoNextMonth,
  canGoNextWeek,
  getMonthRange,
  getWeekRange,
  resolveFirstActivityDate,
  roundChartMax,
} from "@/lib/shootingAnalytics";
import { SkillProfile } from "@/lib/skillRatings";
import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

const CHART_HEIGHT = 180;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_WIDTH = SCREEN_WIDTH - 76;

const PERIOD_LABELS: Record<ShootingChartPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  alltime: "All Time",
};

const SKILL_LABELS: Record<string, string> = {
  shooting: "Shooting",
  ball_handling: "Handle",
  finishing: "Finishing",
  defense: "Defense",
  conditioning: "Conditioning",
  basketball_iq: "Basketball IQ",
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

function getSkillLabelLines(key: string, compact: boolean): string[] {
  if (compact) return [COMPACT_SKILL_LABELS[key] ?? key];
  if (key === "basketball_iq") return ["Basketball", "IQ"];
  if (key === "ball_handling") return ["Ball", "Handling"];
  return [SKILL_LABELS[key] ?? key];
}

export function SkillRadarChart({
  profile,
  compact = false,
}: {
  profile: SkillProfile;
  compact?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const size = compact ? 196 : CHART_WIDTH + 16;
  const pad = compact ? 20 : 52;
  const svgSize = size + pad * 2;
  const center = svgSize / 2;
  const radius = size * (compact ? 0.3 : 0.27);
  const labelRadius = radius + (compact ? 16 : 22);
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

      <View style={[styles.radarSvgWrap, { width: size, height: size }]}>
        <Svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          style={{ position: "absolute", left: -pad, top: -pad }}
        >
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
          const lines = getSkillLabelLines(skill.key, compact);
          const labelFontSize = compact ? 8 : 8;
          const lineHeight = compact ? 9 : 10;
          const scoreY = y - 2 + lines.length * lineHeight + (compact ? 8 : 9);
          return (
            <React.Fragment key={`${skill.key}-label`}>
              {lines.map((line, lineIndex) => (
                <SvgText
                  key={`${skill.key}-line-${lineIndex}`}
                  x={x}
                  y={y - 2 + lineIndex * lineHeight}
                  fill={colors.textSecondary}
                  fontSize={labelFontSize}
                  fontWeight="600"
                  textAnchor={anchor}
                >
                  {line}
                </SvgText>
              ))}
              <SvgText
                x={x}
                y={scoreY}
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
    </View>
  );
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: ShootingChartPeriod;
  onChange: (period: ShootingChartPeriod) => void;
}) {
  const { colors } = useTheme();
  const periods: ShootingChartPeriod[] = ["weekly", "monthly", "alltime"];

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

function ShootingBarChart({
  buckets,
  chartMax,
  width = CHART_WIDTH,
}: {
  buckets: ShootingBucket[];
  chartMax: number;
  width?: number;
}) {
  const { colors, scheme } = useTheme();
  const missColor = scheme === "dark" ? MISS_GREY.dark : MISS_GREY.light;
  const plotHeight = CHART_HEIGHT - 36;
  const leftPad = 28;
  const rightPad = 12;
  const usableWidth = width - leftPad - rightPad;
  const count = Math.max(buckets.length, 1);
  const barGap = count > 1 ? Math.min(14, usableWidth / count / 4) : 0;
  const barWidth = (usableWidth - barGap * (count - 1)) / count;
  const unit = plotHeight / chartMax;

  return (
    <Svg width={width} height={CHART_HEIGHT}>
      {[0, 0.5, 1].map((fraction) => {
        const y = plotHeight - fraction * plotHeight + 8;
        const value = Math.round(chartMax * fraction);
        return (
          <React.Fragment key={fraction}>
            <Line
              x1={leftPad}
              y1={y}
              x2={width - rightPad}
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

      {buckets.map((bucket, index) => {
        const x = leftPad + index * (barWidth + barGap);
        const makesHeight = bucket.makes * unit;
        const missesHeight = bucket.misses * unit;
        const baseY = plotHeight + 8;
        const makesY = baseY - makesHeight;
        const missesY = makesY - missesHeight;

        return (
          <React.Fragment key={`${bucket.label}-${index}`}>
            {makesHeight > 0 ? (
              <Rect
                x={x}
                y={makesY}
                width={barWidth}
                height={makesHeight}
                rx={4}
                fill={colors.accent}
              />
            ) : null}
            {missesHeight > 0 ? (
              <Rect
                x={x}
                y={missesY}
                width={barWidth}
                height={missesHeight}
                rx={4}
                fill={missColor}
              />
            ) : null}
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
  );
}

export function MakesMissesChartPanel({
  logs,
  firstActivityDate,
}: {
  logs: ShootingLogEntry[];
  firstActivityDate: string | null;
}) {
  const { colors, scheme } = useTheme();
  const missColor = scheme === "dark" ? MISS_GREY.dark : MISS_GREY.light;
  const [period, setPeriod] = useState<ShootingChartPeriod>("weekly");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);

  const buckets = useMemo(() => {
    if (period === "weekly") return buildWeeklyBuckets(logs, weekOffset);
    if (period === "monthly") return buildMonthlyBuckets(logs, monthOffset);
    const first = resolveFirstActivityDate(logs, firstActivityDate);
    return buildAllTimeBuckets(logs, first);
  }, [logs, firstActivityDate, period, weekOffset, monthOffset]);

  const peak = Math.max(...buckets.map((b) => b.makes + b.misses), 0);
  const chartMax = roundChartMax(peak);
  const totalMakes = buckets.reduce((sum, b) => sum + b.makes, 0);
  const totalMisses = buckets.reduce((sum, b) => sum + b.misses, 0);
  const hasData = peak > 0;

  const navLabel = useMemo(() => {
    if (period === "weekly") return getWeekRange(weekOffset).label;
    if (period === "monthly") return getMonthRange(monthOffset).label;
    return "All months";
  }, [period, weekOffset, monthOffset]);

  return (
    <View>
      <PeriodSelector
        value={period}
        onChange={(next) => {
          setPeriod(next);
          setWeekOffset(0);
          setMonthOffset(0);
        }}
      />

      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total</Text>
        <Text style={[styles.totalMakes, { color: colors.accent }]}>{totalMakes}</Text>
        <Text style={[styles.totalMisses, { color: missColor }]}>{totalMisses}</Text>
      </View>

      {!hasData ? (
        <Text style={{ color: colors.textSecondary }}>
          Log shooting drills to see makes and misses over time.
        </Text>
      ) : period === "alltime" && buckets.length > 6 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ShootingBarChart
            buckets={buckets}
            chartMax={chartMax}
            width={Math.max(CHART_WIDTH, buckets.length * 42 + 40)}
          />
        </ScrollView>
      ) : (
        <ShootingBarChart buckets={buckets} chartMax={chartMax} />
      )}

      {period !== "alltime" ? (
        <View style={styles.periodNavRow}>
          <Pressable
            onPress={() =>
              period === "weekly"
                ? setWeekOffset((v) => v + 1)
                : setMonthOffset((v) => v + 1)
            }
            hitSlop={8}
            style={[styles.periodNavButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.periodNavArrow, { color: colors.text }]}>‹</Text>
          </Pressable>
          <Text style={[styles.periodNavLabel, { color: colors.textSecondary }]}>{navLabel}</Text>
          <Pressable
            onPress={() =>
              period === "weekly"
                ? setWeekOffset((v) => Math.max(0, v - 1))
                : setMonthOffset((v) => Math.max(0, v - 1))
            }
            disabled={
              period === "weekly" ? !canGoNextWeek(weekOffset) : !canGoNextMonth(monthOffset)
            }
            hitSlop={8}
            style={[
              styles.periodNavButton,
              {
                borderColor: colors.border,
                opacity:
                  period === "weekly"
                    ? canGoNextWeek(weekOffset)
                      ? 1
                      : 0.35
                    : canGoNextMonth(monthOffset)
                      ? 1
                      : 0.35,
              },
            ]}
          >
            <Text style={[styles.periodNavArrow, { color: colors.text }]}>›</Text>
          </Pressable>
        </View>
      ) : null}
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
    overflow: "visible",
  },
  radarSvgWrap: {
    overflow: "visible",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
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
  periodNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 10,
  },
  periodNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  periodNavArrow: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  periodNavLabel: {
    fontSize: 13,
    fontWeight: "700",
    minWidth: 140,
    textAlign: "center",
  },
});
