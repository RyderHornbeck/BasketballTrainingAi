import { computeShotMapData, type ShotMapLogEntry, zoneHeatColor } from "@/lib/shotMap";
import {
  buildCourtMarkings,
  COURT,
  COURT_VIEWBOX,
  SHOT_ZONE_LAYOUTS,
} from "@/lib/shotMapCourt";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

const ORANGE = "#F2721D";

interface VideoShotMapProps {
  logs: ShotMapLogEntry[];
  width: number;
}

/** Transparent live-camera variation of the Analytics shot map. */
export function VideoShotMap({ logs, width }: VideoShotMapProps) {
  const height = (width * COURT_VIEWBOX.height) / COURT_VIEWBOX.width;
  const data = useMemo(() => computeShotMapData(logs), [logs]);
  const statsById = useMemo(
    () => Object.fromEntries(data.zones.map((zone) => [zone.id, zone])),
    [data.zones],
  );
  const courtLines = useMemo(() => buildCourtMarkings(), []);

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${COURT_VIEWBOX.width} ${COURT_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <Rect
          x={0}
          y={0}
          width={COURT_VIEWBOX.width}
          height={COURT_VIEWBOX.height}
          rx={12}
          fill="transparent"
          stroke={ORANGE}
          strokeWidth={3.5}
        />
        {SHOT_ZONE_LAYOUTS.map((zone) => {
          const stats = statsById[zone.id];
          const attempted = stats?.attempted ?? 0;
          return (
            <Path
              key={`fill-${zone.id}`}
              d={zone.path}
              fill={attempted ? zoneHeatColor(stats?.pct ?? null, true, true) : "transparent"}
            />
          );
        })}
        <G stroke={ORANGE} strokeWidth={3} fill="none">
          {SHOT_ZONE_LAYOUTS.filter(
            (zone) => zone.id !== "top_of_key_three" && zone.id !== "center_midrange",
          ).map((zone) => <Path key={`boundary-${zone.id}`} d={zone.path} />)}
          <Line x1={200} y1={COURT.topY} x2={400} y2={COURT.topY} />
          <Line x1={200} y1={COURT.topY} x2={185} y2={231} />
          <Line x1={400} y1={COURT.topY} x2={415} y2={231} />
          <Line x1={240} y1={COURT.ftY} x2={185} y2={231} />
          <Line x1={360} y1={COURT.ftY} x2={415} y2={231} />
          <Path d={courtLines.paint} />
          <Path d={courtLines.ftLine} />
          <Path d={courtLines.ftSemicircle} />
          <Path d={courtLines.restrictedArc} />
          <Path d={courtLines.threePoint} />
          <Line x1={COURT.basketX - 18} y1={COURT.basketY + 8} x2={COURT.basketX + 18} y2={COURT.basketY + 8} />
        </G>
        <Circle cx={COURT.basketX} cy={COURT.basketY} r={6} fill="transparent" stroke={ORANGE} strokeWidth={3} />
        {SHOT_ZONE_LAYOUTS.map((zone) => {
          const stats = statsById[zone.id];
          const attempted = stats?.attempted ?? 0;
          if (!attempted) return null;
          const pctSize = (zone.labelSize ?? 12) + 5;
          const ratioSize = (zone.ratioSize ?? 9) + 2;
          return (
            <G key={`label-${zone.id}`}>
              <SvgText x={zone.labelX} y={zone.labelY} fill="#FFFFFF" fontSize={pctSize} fontWeight="700" textAnchor="middle">
                {stats?.pct ?? 0}%
              </SvgText>
              <SvgText x={zone.labelX} y={zone.labelY + pctSize + 2} fill="#FFFFFF" fontSize={ratioSize} fontWeight="600" textAnchor="middle">
                {stats?.made ?? 0}/{attempted}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden" },
});
