import { decodeExerciseLogMeta } from "./exerciseSetLogs";

export type ShotMapViewMode = "heatmap" | "dots";

export type ShotZoneId =
  | "rim"
  | "paint_left"
  | "paint_right"
  | "mid_left_corner"
  | "mid_left_wing"
  | "mid_center"
  | "mid_right_wing"
  | "mid_right_corner"
  | "three_left_wing"
  | "three_top"
  | "three_right_wing"
  | "deep_left"
  | "deep_center"
  | "deep_right";

export interface ShotZoneLayout {
  id: ShotZoneId;
  label: string;
  path: string;
  labelX: number;
  labelY: number;
  dotBounds: { x: number; y: number; w: number; h: number };
}

export interface ShotZoneStats {
  id: ShotZoneId;
  label: string;
  makes: number;
  attempts: number;
  pct: number | null;
}

export interface ShotDot {
  zoneId: ShotZoneId;
  made: boolean;
  x: number;
  y: number;
}

export interface ShotMapData {
  zones: ShotZoneStats[];
  dots: ShotDot[];
  overallPct: number | null;
  totalMakes: number;
  totalAttempts: number;
}

export const SHOT_ZONE_LAYOUTS: ShotZoneLayout[] = [
  {
    id: "rim",
    label: "Rim",
    path: "M 86 176 L 114 176 A 14 14 0 0 1 114 204 L 86 204 Z",
    labelX: 100,
    labelY: 192,
    dotBounds: { x: 88, y: 178, w: 24, h: 22 },
  },
  {
    id: "paint_left",
    label: "Paint L",
    path: "M 58 150 L 86 150 L 86 204 L 58 204 Z",
    labelX: 72,
    labelY: 180,
    dotBounds: { x: 60, y: 152, w: 24, h: 50 },
  },
  {
    id: "paint_right",
    label: "Paint R",
    path: "M 114 150 L 142 150 L 142 204 L 114 204 Z",
    labelX: 128,
    labelY: 180,
    dotBounds: { x: 116, y: 152, w: 24, h: 50 },
  },
  {
    id: "mid_left_corner",
    label: "Mid L",
    path: "M 12 132 L 58 132 L 58 150 L 12 150 Z",
    labelX: 35,
    labelY: 142,
    dotBounds: { x: 14, y: 134, w: 42, h: 14 },
  },
  {
    id: "mid_left_wing",
    label: "Mid LW",
    path: "M 12 96 L 58 96 L 58 132 L 12 132 Z",
    labelX: 35,
    labelY: 116,
    dotBounds: { x: 14, y: 98, w: 42, h: 32 },
  },
  {
    id: "mid_center",
    label: "Mid C",
    path: "M 58 96 L 142 96 L 142 150 L 58 150 Z",
    labelX: 100,
    labelY: 126,
    dotBounds: { x: 60, y: 98, w: 80, h: 50 },
  },
  {
    id: "mid_right_wing",
    label: "Mid RW",
    path: "M 142 96 L 188 96 L 188 132 L 142 132 Z",
    labelX: 165,
    labelY: 116,
    dotBounds: { x: 144, y: 98, w: 42, h: 32 },
  },
  {
    id: "mid_right_corner",
    label: "Mid R",
    path: "M 142 132 L 188 132 L 188 150 L 142 150 Z",
    labelX: 165,
    labelY: 142,
    dotBounds: { x: 144, y: 134, w: 42, h: 14 },
  },
  {
    id: "three_left_wing",
    label: "3PT LW",
    path: "M 12 58 L 58 58 L 58 96 L 12 96 Z",
    labelX: 35,
    labelY: 78,
    dotBounds: { x: 14, y: 60, w: 42, h: 34 },
  },
  {
    id: "three_top",
    label: "3PT Top",
    path: "M 58 58 L 142 58 L 142 96 L 58 96 Z",
    labelX: 100,
    labelY: 78,
    dotBounds: { x: 60, y: 60, w: 80, h: 34 },
  },
  {
    id: "three_right_wing",
    label: "3PT RW",
    path: "M 142 58 L 188 58 L 188 96 L 142 96 Z",
    labelX: 165,
    labelY: 78,
    dotBounds: { x: 144, y: 60, w: 42, h: 34 },
  },
  {
    id: "deep_left",
    label: "Deep L",
    path: "M 12 18 L 58 18 L 58 58 L 12 58 Z",
    labelX: 35,
    labelY: 40,
    dotBounds: { x: 14, y: 20, w: 42, h: 36 },
  },
  {
    id: "deep_center",
    label: "Deep C",
    path: "M 58 18 L 142 18 L 142 58 L 58 58 Z",
    labelX: 100,
    labelY: 40,
    dotBounds: { x: 60, y: 20, w: 80, h: 36 },
  },
  {
    id: "deep_right",
    label: "Deep R",
    path: "M 142 18 L 188 18 L 188 58 L 142 58 Z",
    labelX: 165,
    labelY: 40,
    dotBounds: { x: 144, y: 20, w: 42, h: 36 },
  },
];

const ZONE_BY_ID = Object.fromEntries(SHOT_ZONE_LAYOUTS.map((zone) => [zone.id, zone])) as Record<
  ShotZoneId,
  ShotZoneLayout
>;

export function classifyShotZone(name: string, category: string): ShotZoneId {
  const text = name.toLowerCase();

  if (
    category === "finishing" ||
    /layup|rim|mikan|finger roll|floater|finish|backboard|cradle|euro|spill|touch|inside hand|outside hand/i.test(
      text
    )
  ) {
    if (/left block|paint left|left side|left angle/i.test(text)) return "paint_left";
    if (/right block|paint right|right side|right angle/i.test(text)) return "paint_right";
    return "rim";
  }

  if (/3[\s-]?(point|pt)|three|crackback|deep three|logo/i.test(text)) {
    if (/left corner|baseline left/i.test(text)) return "deep_left";
    if (/right corner|baseline right/i.test(text)) return "deep_right";
    if (/left wing|left side/i.test(text)) return "three_left_wing";
    if (/right wing|right side/i.test(text)) return "three_right_wing";
    if (/top|center|key/i.test(text)) return "three_top";
    return "deep_center";
  }

  if (/corner|baseline/i.test(text)) {
    if (/left/i.test(text)) return "mid_left_corner";
    if (/right/i.test(text)) return "mid_right_corner";
  }
  if (/left wing|free throw.*left/i.test(text)) return "mid_left_wing";
  if (/right wing|free throw.*right/i.test(text)) return "mid_right_wing";
  if (/top|center|free throw|midrange|mid-range|pull-up|pull up/i.test(text)) return "mid_center";

  if (category === "shooting") return "mid_center";
  return "mid_center";
}

function jitterDotPosition(seed: number, bounds: ShotZoneLayout["dotBounds"]): { x: number; y: number } {
  const x = bounds.x + 4 + ((seed * 17) % Math.max(1, bounds.w - 8));
  const y = bounds.y + 4 + ((seed * 31) % Math.max(1, bounds.h - 8));
  return { x, y };
}

function pushDotsForAttempts(
  dots: ShotDot[],
  zoneId: ShotZoneId,
  makes: number,
  attempts: number,
  seedBase: number
) {
  const bounds = ZONE_BY_ID[zoneId].dotBounds;
  const misses = Math.max(0, attempts - makes);
  let seed = seedBase;

  for (let i = 0; i < makes; i++) {
    const point = jitterDotPosition(seed++, bounds);
    dots.push({ zoneId, made: true, x: point.x, y: point.y });
  }
  for (let i = 0; i < misses; i++) {
    const point = jitterDotPosition(seed++, bounds);
    dots.push({ zoneId, made: false, x: point.x, y: point.y });
  }
}

export function zoneHeatColor(pct: number | null, hasData: boolean): string {
  if (!hasData || pct == null) return "rgba(210, 210, 210, 0.45)";
  if (pct >= 50) return "rgba(76, 175, 80, 0.82)";
  if (pct >= 30) return "rgba(255, 193, 7, 0.82)";
  return "rgba(244, 67, 54, 0.82)";
}

export function computeShotMapData(exerciseLogs: any[]): ShotMapData {
  const zoneAgg = Object.fromEntries(
    SHOT_ZONE_LAYOUTS.map((zone) => [zone.id, { makes: 0, attempts: 0 }])
  ) as Record<ShotZoneId, { makes: number; attempts: number }>;
  const dots: ShotDot[] = [];
  let dotSeed = 0;

  for (const log of exerciseLogs ?? []) {
    const category = log.workout_exercises?.category ?? "";
    if (category !== "shooting" && category !== "finishing") continue;

    const name = log.workout_exercises?.name ?? "Shot";
    const zoneId = classifyShotZone(name, category);
    const meta = decodeExerciseLogMeta(log.notes);

    if (meta.set_logs?.length) {
      for (const entry of meta.set_logs) {
        const makes = entry.makes ?? 0;
        const attempts = entry.attempts ?? makes;
        if (attempts <= 0) continue;
        zoneAgg[zoneId].makes += makes;
        zoneAgg[zoneId].attempts += attempts;
        pushDotsForAttempts(dots, zoneId, makes, attempts, dotSeed);
        dotSeed += attempts + 1;
      }
      continue;
    }

    const makes = log.makes ?? 0;
    const attempts = log.attempts ?? 0;
    if (attempts <= 0) continue;
    zoneAgg[zoneId].makes += makes;
    zoneAgg[zoneId].attempts += attempts;
    pushDotsForAttempts(dots, zoneId, makes, attempts, dotSeed);
    dotSeed += attempts + 1;
  }

  const zones: ShotZoneStats[] = SHOT_ZONE_LAYOUTS.map((layout) => {
    const stats = zoneAgg[layout.id];
    const pct =
      stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : null;
    return {
      id: layout.id,
      label: layout.label,
      makes: stats.makes,
      attempts: stats.attempts,
      pct,
    };
  });

  const totalMakes = zones.reduce((sum, zone) => sum + zone.makes, 0);
  const totalAttempts = zones.reduce((sum, zone) => sum + zone.attempts, 0);

  return {
    zones,
    dots,
    totalMakes,
    totalAttempts,
    overallPct:
      totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null,
  };
}
