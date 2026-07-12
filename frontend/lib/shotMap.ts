import { decodeExerciseLogMeta } from "./exerciseSetLogs";
import {
  SHOT_ZONE_LAYOUTS,
  ShotZoneId,
  ZONE_BY_ID,
} from "./shotMapCourt";

export type { ShotZoneId } from "./shotMapCourt";
export { SHOT_ZONE_LAYOUTS, COURT_VIEWBOX } from "./shotMapCourt";

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

export interface ShotMapLogEntry {
  created_at: string;
  completed?: boolean | null;
  notes?: string | null;
  makes?: number | null;
  attempts?: number | null;
  workout_exercises?: {
    category?: string | null;
    name?: string | null;
    instructions?: string | null;
    set_side_labels?: string[] | null;
  } | null;
}

const NON_MAPPABLE_SHOT_DRILLS =
  /^(3 Lift Shot|Killer 3s|Hot Lava Shooting|X Shooting|Shadow Shooting|Shooting Footwork \(No Ball\)|Wall Shooting)$/i;

/** Softened heat colors — court lines render above these fills */
export function zoneHeatColor(
  pct: number | null,
  hasData: boolean,
  darkMode = false
): string {
  if (!hasData || pct == null) {
    return darkMode ? "rgba(82, 78, 75, 0.72)" : "rgba(220, 220, 220, 0.55)";
  }
  if (pct >= 80) return "rgba(34, 197, 94, 0.94)";
  if (pct >= 50) return "rgba(88, 168, 108, 0.78)";
  if (pct >= 30) return "rgba(232, 168, 72, 0.78)";
  return "rgba(214, 96, 88, 0.78)";
}

function uniqueZones(zones: ShotZoneId[]): ShotZoneId[] {
  return [...new Set(zones)];
}

function expandMirroredZones(zones: ShotZoneId[], text: string): ShotZoneId[] {
  if (!/mirror|both (sides|wings|blocks)|repeat from both/i.test(text)) return uniqueZones(zones);
  const expanded = [...zones];
  for (const zone of zones) {
    if (zone.startsWith("left_")) {
      expanded.push(zone.replace(/^left_/, "right_") as ShotZoneId);
    } else if (zone.startsWith("right_")) {
      expanded.push(zone.replace(/^right_/, "left_") as ShotZoneId);
    }
  }
  return uniqueZones(expanded);
}

function isThreePointShot(text: string): boolean {
  return /3[\s-]?(point|pt)s?|\b3s\b|\bthrees\b|\bthree[\s-]pointer\b|\bshoot(?:s|ing)? (?:a |the )?three\b|\binto\s+(a\s+)?3\b|\b3\s+lift\b|crackback|behind the three-point line/i.test(
    text
  );
}

function finishingSideZones(text: string): ShotZoneId[] {
  const zones: ShotZoneId[] = [];
  const explicitlyBilateral =
    /both (sides|wings|blocks)|repeat from both|mirror (every step|the drill)|then (move|mirror|repeat|[^\n.]*from) (to |on |from )?the? ?left|alternate sides|alternating|right to left.*left to right/i.test(
      text
    );
  const hasLeft =
    explicitlyBilateral ||
    /left (block|short|angle|side|wing|baseline)|from the left|going left|driving left|left-hand layup/i.test(
      text
    );
  const hasRight =
    explicitlyBilateral ||
    /right (block|short|angle|side|wing|baseline)|from the right|going right|driving right|right-hand layup/i.test(
      text
    );
  if (hasLeft) zones.push("left_short_range");
  if (hasRight) zones.push("right_short_range");
  return zones;
}

/**
 * Returns every zone represented by a drill. Older catalog drills often train
 * both sides or all five perimeter spots in one logged exercise.
 */
export function classifyShotZones(
  name: string,
  category: string,
  instructions = ""
): ShotZoneId[] {
  const text = `${name} ${instructions}`.toLowerCase();

  // A few legacy clips sit under the finishing section even though the drill
  // explicitly records jump shots. Route those by the shot they actually train.
  if (/free throw line extended/i.test(text)) {
    return ["left_midrange", "right_midrange"];
  }
  if (category === "finishing" && /pull-up or layup|finish or shoot/i.test(text)) {
    return ["center_midrange", "rim"];
  }

  if (category === "finishing") {
    // These finishes happen directly at or underneath the basket, even when
    // the drill alternates the left and right sides.
    if (
      /mikan|under (the )?(basket|rim)|at the rim|reverse layup|reverse finish|no jump finishing|form shot near the rim/i.test(
        text
      )
    ) {
      return ["rim"];
    }
    // Floaters belong in the paint even when approached from a named side.
    if (/floater|tear drop/i.test(text)) {
      return ["paint"];
    }

    const sideZones = finishingSideZones(text);
    if (/\b(layup|finger roll|baby hook|hook shot)\b/i.test(text) && sideZones.length > 0) {
      return uniqueZones(sideZones);
    }
    // Other shots explicitly released in the lane belong in the paint.
    if (/paint|lane|free-throw line|free throw line/i.test(text)) {
      return ["paint"];
    }
    return uniqueZones(sideZones.length > 0 ? sideZones : ["rim"]);
  }

  // "3 Point Step In" starts behind the arc but explicitly finishes with
  // mid-range jumpers from both wings.
  if (/3[\s-]?point step[\s-]?in/i.test(text)) {
    return ["left_midrange", "right_midrange"];
  }
  if (/\bfloater\b|tear drop/i.test(text)) {
    return ["paint"];
  }
  if (/three or mid[\s-]?range|mid[\s-]?range or three/i.test(text)) {
    return ["top_of_key_three", "center_midrange"];
  }

  if (isThreePointShot(text)) {
    if (
      /five (three-point )?spots|5 (three-point )?spots|corners, wings, (and )?top|top.*wings.*corners/i.test(
        text
      )
    ) {
      return [
        "left_corner_three",
        "left_wing_three",
        "top_of_key_three",
        "right_wing_three",
        "right_corner_three",
      ];
    }

    const threeZones: ShotZoneId[] = [];
    if (/left corner|baseline left/i.test(text)) threeZones.push("left_corner_three");
    if (/right corner|baseline right/i.test(text)) threeZones.push("right_corner_three");
    if (/left wing/i.test(text)) threeZones.push("left_wing_three");
    if (/right wing/i.test(text)) threeZones.push("right_wing_three");
    if (/\btop( of (the )?key)?\b|\bcenter\b/i.test(text)) threeZones.push("top_of_key_three");
    if (threeZones.length === 0 && /both wings|from the wing|on the wing/i.test(text)) {
      threeZones.push("left_wing_three", "right_wing_three");
    }
    return expandMirroredZones(
      threeZones.length > 0 ? threeZones : ["top_of_key_three"],
      text
    );
  }

  if (/near the rim|in front of the basket|form shooting|single arm shooting/i.test(text)) {
    return ["rim"];
  }

  const midrangeZones: ShotZoneId[] = [];
  if (/left[- ]side baseline mid[\s-]?range|left baseline mid[\s-]?range/i.test(text)) {
    midrangeZones.push("left_midrange");
  }
  if (/right[- ]side baseline mid[\s-]?range|right baseline mid[\s-]?range/i.test(text)) {
    midrangeZones.push("right_midrange");
  }
  if (/left (elbow|wing)|left.*free-throw|left.*free throw/i.test(text)) {
    midrangeZones.push("left_midrange");
  }
  if (/right (elbow|wing)|right.*free-throw|right.*free throw/i.test(text)) {
    midrangeZones.push("right_midrange");
  }
  if (/center.*free-throw|center.*free throw|top of (the )?key/i.test(text)) {
    midrangeZones.push("center_midrange");
  }
  if (midrangeZones.length > 0) return expandMirroredZones(midrangeZones, text);

  const closeRangeZones: ShotZoneId[] = [];
  if (/left[- ]block short[\s-]?range|left block.*short[\s-]?range/i.test(text)) {
    closeRangeZones.push("left_short_range");
  }
  if (/right[- ]block short[\s-]?range|right block.*short[\s-]?range/i.test(text)) {
    closeRangeZones.push("right_short_range");
  }
  if (closeRangeZones.length > 0) return expandMirroredZones(closeRangeZones, text);

  if (/corner|baseline|short corner/i.test(text)) {
    const shortZones: ShotZoneId[] = [];
    if (/left|both sides|each baseline/i.test(text)) shortZones.push("left_short_range");
    if (/right|both sides|each baseline/i.test(text)) shortZones.push("right_short_range");
    if (shortZones.length > 0) return expandMirroredZones(shortZones, text);
  }

  return ["center_midrange"];
}

/** Compatibility helper for callers that only support one zone. */
export function classifyShotZone(
  name: string,
  category: string,
  instructions = ""
): ShotZoneId {
  return classifyShotZones(name, category, instructions)[0];
}

export function classifyShotZonesForSet(
  name: string,
  category: string,
  instructions: string,
  sideLabel?: string | null
): ShotZoneId[] {
  const zones = classifyShotZones(name, category, instructions);
  const side = /left/i.test(sideLabel ?? "") ? "left" : /right/i.test(sideLabel ?? "") ? "right" : null;
  if (!side) return zones;

  const text = `${name} ${instructions}`.toLowerCase();
  const isThree = isThreePointShot(text);
  const centerOnly =
    zones.length === 1 &&
    ["rim", "paint", "center_midrange", "top_of_key_three"].includes(zones[0]);
  if (centerOnly) return zones;

  if (category === "finishing" && zones.some((zone) => zone.endsWith("_short_range"))) {
    return [`${side}_short_range`];
  }
  if (isThree && /relocat|drive[\s-]?(and[\s-]?)?kick|crackback/i.test(text)) {
    return [`${side}_wing_three`];
  }

  const sideZone = zones.find((zone) => zone.startsWith(`${side}_`));
  if (sideZone) return [sideZone];

  if (isThree) {
    if (/corner/i.test(text) && !/wing/i.test(text)) return [`${side}_corner_three`];
    if (/wing|relocat|drive[\s-]?kick/i.test(text)) return [`${side}_wing_three`];
  }
  if (/elbow|wing|mid[\s-]?range|free[\s-]?throw/i.test(text) && category === "shooting") {
    return [`${side}_midrange`];
  }

  return zones;
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

function distributeCount(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0));
}

function addShotResults(
  zoneAgg: Record<ShotZoneId, { makes: number; attempts: number }>,
  dots: ShotDot[],
  zoneIds: ShotZoneId[],
  makes: number,
  attempts: number,
  seedBase: number
): number {
  const attemptShares = distributeCount(attempts, zoneIds.length);
  const makeShares = distributeCount(makes, zoneIds.length);
  let nextSeed = seedBase;

  zoneIds.forEach((zoneId, index) => {
    const zoneAttempts = attemptShares[index];
    const zoneMakes = Math.min(makeShares[index], zoneAttempts);
    zoneAgg[zoneId].makes += zoneMakes;
    zoneAgg[zoneId].attempts += zoneAttempts;
    pushDotsForAttempts(dots, zoneId, zoneMakes, zoneAttempts, nextSeed);
    nextSeed += zoneAttempts + 1;
  });

  return nextSeed;
}

export function computeShotMapData(exerciseLogs: ShotMapLogEntry[]): ShotMapData {
  const zoneAgg = Object.fromEntries(
    SHOT_ZONE_LAYOUTS.map((zone) => [zone.id, { makes: 0, attempts: 0 }])
  ) as Record<ShotZoneId, { makes: number; attempts: number }>;
  const dots: ShotDot[] = [];
  let dotSeed = 0;

  for (const log of exerciseLogs ?? []) {
    const category = log.workout_exercises?.category ?? "";
    if (category !== "shooting" && category !== "finishing") continue;

    const name = log.workout_exercises?.name ?? "Shot";
    // These circuits combine four or five locations into one aggregate log.
    // Without per-spot makes/attempts, assigning or evenly splitting them would
    // fabricate zone accuracy, so only single-location/per-side drills map.
    if (NON_MAPPABLE_SHOT_DRILLS.test(name.trim())) {
      continue;
    }
    const instructions = log.workout_exercises?.instructions ?? "";
    const zoneIds = classifyShotZones(name, category, instructions);
    const sideLabels = log.workout_exercises?.set_side_labels ?? null;
    const meta = decodeExerciseLogMeta(log.notes);

    if (meta.set_logs?.length) {
      for (const entry of meta.set_logs) {
        if (!entry.completed) continue;
        const makes = entry.makes ?? 0;
        const attempts = entry.attempts ?? makes;
        if (attempts <= 0) continue;
        const entryZones = classifyShotZonesForSet(
          name,
          category,
          instructions,
          sideLabels?.[entry.set_number - 1]
        );
        dotSeed = addShotResults(zoneAgg, dots, entryZones, makes, attempts, dotSeed);
      }
      continue;
    }

    if (!log.completed && log.makes == null) continue;
    const makes = log.makes ?? 0;
    const attempts = log.attempts ?? 0;
    if (attempts <= 0) continue;
    dotSeed = addShotResults(zoneAgg, dots, zoneIds, makes, attempts, dotSeed);
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
