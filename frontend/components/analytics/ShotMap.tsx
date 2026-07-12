import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  ShotMapData,
  ShotMapViewMode,
  zoneHeatColor,
} from "@/lib/shotMap";
import {
  buildCourtMarkings,
  COURT,
  COURT_VIEWBOX,
  SHOT_ZONE_LAYOUTS,
} from "@/lib/shotMapCourt";
import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

const DIVIDER_COLOR = "#F7B379";
const COURT_LINE_COLOR = "#F7B379";
const COURT_FLOOR = "#F3E7D8";

interface ShotMapProps {
  data: ShotMapData;
  width?: number;
  /** Optional explicit shot coordinates for dots mode */
  shots?: { x: number; y: number; made: boolean }[];
}

export function ShotMap({ data, width, shots }: ShotMapProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<ShotMapViewMode>("heatmap");
  const screenWidth = Dimensions.get("window").width;
  const mapWidth = width ?? screenWidth - 76;
  const courtHeight = (mapWidth * COURT_VIEWBOX.height) / COURT_VIEWBOX.width;

  const zoneStatsById = useMemo(
    () => Object.fromEntries(data.zones.map((zone) => [zone.id, zone])),
    [data.zones]
  );

  const courtLines = useMemo(() => buildCourtMarkings(), []);
  const hasShotData = data.totalAttempts > 0;
  const dotPoints = shots ?? data.dots;

  return (
    <View style={[styles.card, { backgroundColor: "#FFFFFF", borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.text }]}>Shot Map</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Where you shoot best — this week
          </Text>
        </View>
        <View style={styles.overallWrap}>
          <Text style={[styles.overallLabel, { color: colors.textSecondary }]}>Overall FG%</Text>
          <Text style={[styles.overallPct, { color: colors.text }]}>
            {data.overallPct != null ? `${data.overallPct}%` : "—"}
          </Text>
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={[styles.toggle, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          {(["heatmap", "dots"] as ShotMapViewMode[]).map((option) => {
            const selected = mode === option;
            return (
              <Pressable
                key={option}
                onPress={() => setMode(option)}
                style={[
                  styles.toggleButton,
                  selected && { backgroundColor: DIVIDER_COLOR },
                ]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: selected ? "#FFFFFF" : colors.textSecondary },
                  ]}
                >
                  {option === "heatmap" ? "Heatmap" : "Dots"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Svg
        width={mapWidth}
        height={courtHeight}
        viewBox={`0 0 ${COURT_VIEWBOX.width} ${COURT_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Court floor */}
        <Rect x={0} y={0} width={COURT_VIEWBOX.width} height={COURT_VIEWBOX.height} rx={12} fill={COURT_FLOOR} />

        {/* 1) Zone fills (heatmap) or transparent background (dots) */}
        {mode === "heatmap"
          ? SHOT_ZONE_LAYOUTS.map((zone) => {
              const stats = zoneStatsById[zone.id];
              const hasData = (stats?.attempted ?? 0) > 0;
              const fill = zoneHeatColor(stats?.pct ?? null, hasData);
              return (
                <Path
                  key={`zone-fill-${zone.id}`}
                  d={zone.path}
                  fill={fill}
                  stroke="none"
                />
              );
            })
          : null}

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

        {/* 3) Labels (heatmap) or dots */}
        {mode === "heatmap"
          ? SHOT_ZONE_LAYOUTS.map((zone) => {
              const stats = zoneStatsById[zone.id];
              const attempted = stats?.attempted ?? 0;
              const made = stats?.made ?? 0;
              const hasData = attempted > 0;
              const pctLabel = hasData && stats?.pct != null ? `${stats.pct}%` : "—";
              const ratioLabel = `${made}/${attempted}`;
              const textColor = hasData ? "#FFFFFF" : "#5C5C5C";
              const pctSize = zone.labelSize ?? 12;
              const ratioSize = zone.ratioSize ?? 9;

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
            })
          : dotPoints.map((dot, index) => (
              <Circle
                key={`dot-${index}`}
                cx={dot.x}
                cy={dot.y}
                r={3.2}
                fill={dot.made ? "#58A86C" : "#D66058"}
                opacity={0.92}
              />
            ))}
      </Svg>

      {!hasShotData ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Log shooting drills to populate your shot map.
        </Text>
      ) : null}

      <View style={styles.legendRow}>
        <LegendSwatch color="#58A86C" label="≥ 50%" />
        <LegendSwatch color="#E8A848" label="30–50%" />
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
  toggleRow: {
    alignItems: "flex-end",
    marginBottom: 10,
  },
  toggle: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  toggleButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleText: {
    fontSize: 11,
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
    gap: 14,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
});
