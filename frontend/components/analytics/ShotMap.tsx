import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { computeShotMapData, ShotMapLogEntry, zoneHeatColor } from "@/lib/shotMap";
import {
  buildCourtMarkings,
  COURT,
  COURT_VIEWBOX,
  SHOT_ZONE_LAYOUTS,
} from "@/lib/shotMapCourt";
import { getWeekRange } from "@/lib/shootingAnalytics";
import { CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

const DIVIDER_COLOR = "#F7B379";
const COURT_LINE_COLOR = "#F7B379";

interface ShotMapProps {
  logs: ShotMapLogEntry[];
  width?: number;
}

export function ShotMap({ logs, width }: ShotMapProps) {
  const { colors, scheme } = useTheme();
  const [weekOffset, setWeekOffset] = useState(0);
  const screenWidth = Dimensions.get("window").width;
  const mapWidth = width ?? screenWidth - 76;
  const courtHeight = (mapWidth * COURT_VIEWBOX.height) / COURT_VIEWBOX.width;
  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const data = useMemo(
    () =>
      computeShotMapData(
        logs.filter((log) => {
          const date = new Date(log.created_at);
          return date >= weekRange.start && date <= weekRange.end;
        })
      ),
    [logs, weekRange]
  );

  const zoneStatsById = useMemo(
    () => Object.fromEntries(data.zones.map((zone) => [zone.id, zone])),
    [data.zones]
  );

  const courtLines = useMemo(() => buildCourtMarkings(), []);
  const hasShotData = data.totalAttempts > 0;
  const courtFloor = scheme === "dark" ? "#292522" : "#F3E7D8";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.text }]}>Shot Map</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Where you shoot best
          </Text>
        </View>
        <View style={styles.overallWrap}>
          <Text style={[styles.overallLabel, { color: colors.textSecondary }]}>Overall FG%</Text>
          <Text style={[styles.overallPct, { color: colors.text }]}>
            {data.overallPct != null ? `${data.overallPct}%` : "—"}
          </Text>
        </View>
      </View>

      <View style={styles.weekNavRow}>
        <Pressable
          onPress={() => setWeekOffset((value) => value + 1)}
          hitSlop={8}
          style={[styles.weekNavButton, { borderColor: colors.border }]}
        >
          <CaretLeftIcon size={18} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.weekNavLabel, { color: colors.textSecondary }]}>
          {weekRange.label}
        </Text>
        <Pressable
          onPress={() => setWeekOffset((value) => Math.max(0, value - 1))}
          disabled={weekOffset === 0}
          hitSlop={8}
          style={[
            styles.weekNavButton,
            { borderColor: colors.border, opacity: weekOffset > 0 ? 1 : 0.35 },
          ]}
        >
          <CaretRightIcon size={18} color={colors.text} weight="bold" />
        </Pressable>
      </View>

      <Svg
        width={mapWidth}
        height={courtHeight}
        viewBox={`0 0 ${COURT_VIEWBOX.width} ${COURT_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Court floor */}
        <Rect x={0} y={0} width={COURT_VIEWBOX.width} height={COURT_VIEWBOX.height} rx={12} fill={courtFloor} />

        {/* 1) Zone heatmap fills */}
        {SHOT_ZONE_LAYOUTS.map((zone) => {
          const stats = zoneStatsById[zone.id];
          const hasData = (stats?.attempted ?? 0) > 0;
          const fill = zoneHeatColor(stats?.pct ?? null, hasData, scheme === "dark");
          return (
            <Path
              key={`zone-fill-${zone.id}`}
              d={zone.path}
              fill={fill}
              stroke="none"
            />
          );
        })}

        {/* Thin zone boundaries clarify the radial partition without obscuring court lines. */}
        {SHOT_ZONE_LAYOUTS.filter(
          (zone) =>
            zone.id !== "top_of_key_three" && zone.id !== "center_midrange"
        ).map((zone) => (
          <Path
            key={`zone-boundary-${zone.id}`}
            d={zone.path}
            fill="none"
            stroke={DIVIDER_COLOR}
            strokeWidth={1.6}
          />
        ))}

        {/* Unique center dividers. The shared three-point curve itself is
            rendered once below as a court marking, avoiding a doubled arc. */}
        <G stroke={DIVIDER_COLOR} strokeWidth={2} fill="none">
          <Line x1={200} y1={COURT.topY} x2={400} y2={COURT.topY} />
          <Line x1={200} y1={COURT.topY} x2={185} y2={231} />
          <Line x1={400} y1={COURT.topY} x2={415} y2={231} />
          <Line x1={240} y1={COURT.ftY} x2={185} y2={231} />
          <Line x1={360} y1={COURT.ftY} x2={415} y2={231} />
        </G>

        {/* 2) Court markings — always above fills */}
        <G stroke={COURT_LINE_COLOR} strokeWidth={1.6} fill="none">
          <Path d={courtLines.baseline} />
          <Path d={courtLines.sidelines} />
          <Path d={courtLines.paint} />
          <Path d={courtLines.ftLine} />
          <Path d={courtLines.ftSemicircle} />
          <Path d={courtLines.restrictedArc} />
          <Line
            x1={COURT.basketX - 18}
            y1={COURT.basketY + 8}
            x2={COURT.basketX + 18}
            y2={COURT.basketY + 8}
            stroke={COURT_LINE_COLOR}
            strokeWidth={2}
          />
          <Path d={courtLines.threePoint} />
        </G>

        {/* Basket rim */}
        <Circle
          cx={COURT.basketX}
          cy={COURT.basketY}
          r={6}
          fill="none"
          stroke={COURT_LINE_COLOR}
          strokeWidth={1.8}
        />

        {/* 3) Zone labels */}
        {SHOT_ZONE_LAYOUTS.map((zone) => {
          const stats = zoneStatsById[zone.id];
          const attempted = stats?.attempted ?? 0;
          const made = stats?.made ?? 0;
          const hasData = attempted > 0;
          const pctLabel = hasData && stats?.pct != null ? `${stats.pct}%` : "—";
          const ratioLabel = `${made}/${attempted}`;
          const textColor = hasData ? "#FFFFFF" : colors.textSecondary;
          const pctSize = (zone.labelSize ?? 12) + 8;
          const ratioSize = (zone.ratioSize ?? 9) + 4;

          return (
            <G key={`zone-label-${zone.id}`}>
              <SvgText
                x={zone.labelX}
                y={zone.labelY}
                fill={textColor}
                fontSize={pctSize}
                fontWeight="700"
                textAnchor="middle"
              >
                {pctLabel}
              </SvgText>
              <SvgText
                x={zone.labelX}
                y={zone.labelY + pctSize + 2}
                fill={textColor}
                fontSize={ratioSize}
                fontWeight="600"
                textAnchor="middle"
              >
                {ratioLabel}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      {!hasShotData ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Log shooting drills to populate your shot map.
        </Text>
      ) : null}

      <View style={styles.legendRow}>
        <LegendSwatch color="#22C55E" label="≥ 80%" />
        <LegendSwatch color="#58A86C" label="50–79%" />
        <LegendSwatch color="#E8A848" label="30–49%" />
        <LegendSwatch color="#D66058" label="< 30%" />
      </View>
    </View>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  overallWrap: {
    alignItems: "flex-end",
  },
  overallLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  overallPct: {
    fontSize: 20,
    fontWeight: "800",
    marginTop: 2,
  },
  weekNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 12,
  },
  weekNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  weekNavLabel: {
    minWidth: 140,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
});
