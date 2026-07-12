import { decodeExerciseLogMeta } from "./exerciseSetLogs";
import {
  SHOT_ZONE_LAYOUTS,
  ShotZoneId,
  ZONE_BY_ID,
} from "./shotMapCourt";

export type { ShotZoneId } from "./shotMapCourt";
export { SHOT_ZONE_LAYOUTS, COURT_VIEWBOX } from "./shotMapCourt";

export type ShotMapViewMode = "heatmap" | "dots";

export interface ShotZoneStats {
  id: ShotZoneId;
  name: string;
  made: number;
  attempted: number;
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

/** Softened heat colors — court lines render above these fills */
export function zoneHeatColor(pct: number | null, hasData: boolean): string {
  if (!hasData || pct == null) return "rgba(220, 220, 220, 0.55)";
  if (pct >= 50) return "rgba(88, 168, 108, 0.78)";
  if (pct >= 30) return "rgba(232, 168, 72, 0.78)";
  return "rgba(214, 96, 88, 0.78)";
}

export function classifyShotZone(name: string, category: string): ShotZoneId {
  const text = name.toLowerCase();

  if (
    category === "finishing" ||
    /layup|rim|mikan|finger roll|floater|finish|backboard|cradle|euro|spill|touch|inside hand|outside hand|at.rim/i.test(
      text
    )
  ) {
    if (/left block|paint left|left short|left angle|left side/i.test(text)) return "left_short_range";
    if (/right block|paint right|right short|right angle|right side/i.test(text)) return "right_short_range";
    if (/paint|key|post/i.test(text)) return "paint";
    return "rim";
  }

  if (/3[\s-]?(point|pt)|three|crackback|logo/i.test(text)) {
    if (/left corner|baseline left/i.test(text)) return "left_corner_three";
    if (/right corner|baseline right/i.test(text)) return "right_corner_three";
    if (/left wing|left side/i.test(text)) return "left_wing_three";
    if (/right wing|right side/i.test(text)) return "right_wing_three";
    if (/top|center|key/i.test(text)) return "top_of_key_three";
    return "top_of_key_three";
  }

  if (/corner|baseline/i.test(text)) {
    if (/left/i.test(text)) return "left_short_range";
    if (/right/i.test(text)) return "right_short_range";
  }
  if (/left wing|free throw.*left/i.test(text)) return "left_midrange";
  if (/right wing|free throw.*right/i.test(text)) return "right_midrange";
  if (/top|center|free throw|midrange|mid-range|pull-up|pull up/i.test(text)) {
    return "center_midrange";
  }

  if (category === "shooting") return "center_midrange";
  return "center_midrange";
}

function jitterDotPosition(seed: number, bounds: { x: number; y: number; w: number; h: number }) {
  const x = bounds.x + 6 + ((seed * 17) % Math.max(1, bounds.w - 12));
  const y = bounds.y + 6 + ((seed * 31) % Math.max(1, bounds.h - 12));
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
    const attempted = stats.attempts;
    const made = stats.makes;
    const pct = attempted > 0 ? Math.round((made / attempted) * 100) : null;
    return {
      id: layout.id,
      name: layout.name,
      made,
      attempted,
      pct,
    };
  });

  const totalMakes = zones.reduce((sum, zone) => sum + zone.made, 0);
  const totalAttempts = zones.reduce((sum, zone) => sum + zone.attempted, 0);

  return {
    zones,
    dots,
    totalMakes,
    totalAttempts,
    overallPct:
      totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null,
  };
}
