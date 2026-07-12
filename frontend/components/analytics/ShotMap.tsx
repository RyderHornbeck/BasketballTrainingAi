import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import {
  SHOT_ZONE_LAYOUTS,
  ShotMapData,
  ShotMapViewMode,
  zoneHeatColor,
} from "@/lib/shotMap";
import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";

const COURT_VIEWBOX = { width: 200, height: 210 };
const DIVIDER_COLOR = "#F7B379";

interface ShotMapProps {
  data: ShotMapData;
  width?: number;
}

export function ShotMap({ data, width }: ShotMapProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<ShotMapViewMode>("heatmap");
  const screenWidth = Dimensions.get("window").width;
  const mapWidth = width ?? screenWidth - 76;
  const mapHeight = (mapWidth * COURT_VIEWBOX.height) / COURT_VIEWBOX.width;

  const zoneStatsById = useMemo(
    () => Object.fromEntries(data.zones.map((zone) => [zone.id, zone])),
    [data.zones]
  );

  const hasShotData = data.totalAttempts > 0;

  return (
    <View style={[styles.card, { backgroundColor: "#FFFFFF", borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Shot Map</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Overall FG%{" "}
            <Text style={[styles.overallPct, { color: colors.text }]}>
              {data.overallPct != null ? `${data.overallPct}%` : "--"}
            </Text>
          </Text>
        </View>
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

      <Svg width={mapWidth} height={mapHeight} viewBox={`0 0 ${COURT_VIEWBOX.width} ${COURT_VIEWBOX.height}`}>
        <Rect x={0} y={0} width={200} height={210} rx={10} fill="#F3E7D8" />

        {/* Court markings */}
        <Rect x={58} y={96} width={84} height={108} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
        <Circle cx={100} cy={150} r={18} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
        <Path
          d="M 12 150 A 88 88 0 0 1 188 150"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={1.5}
        />
        <Line x1={12} y1={204} x2={188} y2={204} stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />

        {mode === "heatmap"
          ? SHOT_ZONE_LAYOUTS.map((zone) => {
              const stats = zoneStatsById[zone.id];
              const hasData = (stats?.attempts ?? 0) > 0;
              const fill = zoneHeatColor(stats?.pct ?? null, hasData);
              return (
                <Path
                  key={`zone-${zone.id}`}
                  d={zone.path}
                  fill={fill}
                  stroke={DIVIDER_COLOR}
                  strokeWidth={2}
                />
              );
            })
          : SHOT_ZONE_LAYOUTS.map((zone) => (
              <Path
                key={`zone-outline-${zone.id}`}
                d={zone.path}
                fill="rgba(255,255,255,0.18)"
                stroke={DIVIDER_COLOR}
                strokeWidth={2}
              />
            ))}

        {mode === "heatmap"
          ? SHOT_ZONE_LAYOUTS.map((zone) => {
              const stats = zoneStatsById[zone.id];
              if (!stats || stats.attempts <= 0) return null;
              return (
                <React.Fragment key={`label-${zone.id}`}>
                  <SvgText
                    x={zone.labelX}
                    y={zone.labelY - 4}
                    fill="#FFFFFF"
                    fontSize={11}
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {`${stats.pct}%`}
                  </SvgText>
                  <SvgText
                    x={zone.labelX}
                    y={zone.labelY + 10}
                    fill="#FFFFFF"
                    fontSize={9}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {`${stats.makes}/${stats.attempts}`}
                  </SvgText>
                </React.Fragment>
              );
            })
          : data.dots.map((dot, index) => (
              <Circle
                key={`dot-${index}`}
                cx={dot.x}
                cy={dot.y}
                r={2.6}
                fill={dot.made ? "#4CAF50" : "#F44336"}
                opacity={0.95}
              />
            ))}
      </Svg>

      {!hasShotData ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Log shooting drills to populate your shot map.
        </Text>
      ) : null}

      <View style={styles.legendRow}>
        <LegendSwatch color="#4CAF50" label="≥ 50%" />
        <LegendSwatch color="#FFC107" label="30–50%" />
        <LegendSwatch color="#F44336" label="< 30%" />
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
    marginBottom: 12,
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
  overallPct: {
    fontSize: 14,
    fontWeight: "800",
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
    paddingHorizontal: 10,
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
