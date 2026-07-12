/**
 * Half-court shot-map coordinate system (viewBox 600 × 520).
 *
 * Origin is top-left. Y increases downward.
 * The basket sits near the bottom center; the baseline is the bottom edge.
 * All zone paths and court markings share these constants.
 */
export const COURT_VIEWBOX = { width: 600, height: 470 } as const;

export const COURT = {
  /** Basket / hoop center */
  basketX: 300,
  basketY: 430,
  /** Court boundaries */
  baselineY: 450,
  sidelineL: 30,
  sidelineR: 570,
  topY: 20,
  /** Paint / key */
  paintL: 220,
  paintR: 380,
  ftY: 290,
  ftCircleR: 60,
  /** Restricted area arc radius */
  restrictedR: 40,
  /** Three-point arc radius (measured from basket center) */
  threeR: 230,
  /** Corner three: straight-line segment meets the arc at this Y */
  threeCornerY: 320,
  threeCornerLX: 98,
  threeCornerRX: 502,
} as const;

/** Apex of the three-point arc (top of the arc) */
export const THREE_APEX = {
  x: COURT.basketX,
  y: COURT.basketY - COURT.threeR,
} as const;

export type ShotZoneId =
  | "left_corner_three"
  | "right_corner_three"
  | "left_wing_three"
  | "right_wing_three"
  | "top_of_key_three"
  | "left_midrange"
  | "right_midrange"
  | "center_midrange"
  | "left_short_range"
  | "right_short_range"
  | "paint"
  | "rim";

export interface ShotZoneLayout {
  id: ShotZoneId;
  name: string;
  /** SVG path for the zone polygon/arc region */
  path: string;
  /** Explicit label anchor — not the path bounding-box center */
  labelX: number;
  labelY: number;
  labelSize?: number;
  ratioSize?: number;
  /** Bounds used to jitter shot dots inside the zone */
  dotBounds: { x: number; y: number; w: number; h: number };
}

/**
 * Zone paths trace real half-court geometry:
 * - Outer zones follow the three-point arc and corner straights
 * - Inner zones follow the paint, free-throw line, and restricted arc
 * - All zones radiate outward from the basket at the bottom center
 */
export const SHOT_ZONE_LAYOUTS: ShotZoneLayout[] = [
  {
    id: "left_corner_three",
    name: "Left Corner 3",
    path: `M ${COURT.sidelineL} ${COURT.threeCornerY} L ${COURT.threeCornerLX} ${COURT.threeCornerY} L ${COURT.threeCornerLX} ${COURT.baselineY} L ${COURT.sidelineL} ${COURT.baselineY} Z`,
    labelX: 64,
    labelY: 390,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 34, y: 324, w: 60, h: 122 },
  },
  {
    id: "right_corner_three",
    name: "Right Corner 3",
    path: `M ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.sidelineR} ${COURT.threeCornerY} L ${COURT.sidelineR} ${COURT.baselineY} L ${COURT.threeCornerRX} ${COURT.baselineY} Z`,
    labelX: 536,
    labelY: 390,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 506, y: 324, w: 60, h: 122 },
  },
  {
    id: "left_wing_three",
    name: "Left Wing 3",
    path: `M ${COURT.sidelineL} ${COURT.topY} L 200 ${COURT.topY} L 185 231 A ${COURT.threeR} ${COURT.threeR} 0 0 0 ${COURT.threeCornerLX} ${COURT.threeCornerY} L ${COURT.sidelineL} ${COURT.threeCornerY} Z`,
    labelX: 105,
    labelY: 205,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 34, y: 24, w: 146, h: 290 },
  },
  {
    id: "right_wing_three",
    name: "Right Wing 3",
    path: `M 400 ${COURT.topY} L ${COURT.sidelineR} ${COURT.topY} L ${COURT.sidelineR} ${COURT.threeCornerY} L ${COURT.threeCornerRX} ${COURT.threeCornerY} A ${COURT.threeR} ${COURT.threeR} 0 0 0 415 231 Z`,
    labelX: 495,
    labelY: 205,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 420, y: 24, w: 146, h: 290 },
  },
  {
    id: "top_of_key_three",
    name: "Top of Key 3",
    // Outside the shared three-point arc. This reverse arc uses the same
    // radius and endpoints as center_midrange, so its fill cannot cross the
    // top-of-key boundary.
    path: `M 200 ${COURT.topY} L 400 ${COURT.topY} L 415 231 A ${COURT.threeR} ${COURT.threeR} 0 0 0 185 231 Z`,
    labelX: 300,
    labelY: 120,
    labelSize: 12,
    ratioSize: 9,
    dotBounds: { x: 204, y: 24, w: 192, h: 200 },
  },
  {
    id: "left_midrange",
    name: "Left Mid",
    path: `M ${COURT.threeCornerLX} ${COURT.threeCornerY} A ${COURT.threeR} ${COURT.threeR} 0 0 1 185 231 L 240 ${COURT.ftY} L ${COURT.paintL} ${COURT.ftY} L ${COURT.paintL} 350 Z`,
    labelX: 172,
    labelY: 290,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 104, y: 236, w: 112, h: 108 },
  },
  {
    id: "right_midrange",
    name: "Right Mid",
    path: `M 415 231 A ${COURT.threeR} ${COURT.threeR} 0 0 1 ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.paintR} 350 L ${COURT.paintR} ${COURT.ftY} L 360 ${COURT.ftY} Z`,
    labelX: 428,
    labelY: 290,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 384, y: 236, w: 112, h: 108 },
  },
  {
    id: "center_midrange",
    name: "Center Mid",
    // One closed center-midrange section from the three-point arc through the
    // entire upper free-throw-circle area down to the free-throw line.
    path: `M 185 231 A ${COURT.threeR} ${COURT.threeR} 0 0 1 415 231 L 360 ${COURT.ftY} L 240 ${COURT.ftY} Z`,
    labelX: 300,
    labelY: 254,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 190, y: 205, w: 220, h: 78 },
  },
  {
    id: "left_short_range",
    name: "Left Short",
    path: `M ${COURT.threeCornerLX} ${COURT.threeCornerY} L ${COURT.paintL} 350 L ${COURT.paintL} ${COURT.baselineY} L ${COURT.threeCornerLX} ${COURT.baselineY} Z`,
    labelX: 157,
    labelY: 390,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 102, y: 326, w: 114, h: 120 },
  },
  {
    id: "right_short_range",
    name: "Right Short",
    path: `M ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.paintR} 350 L ${COURT.paintR} ${COURT.baselineY} L ${COURT.threeCornerRX} ${COURT.baselineY} Z`,
    labelX: 443,
    labelY: 390,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 384, y: 326, w: 114, h: 120 },
  },
  {
    id: "paint",
    name: "Paint",
    path: `M ${COURT.paintL} ${COURT.ftY} L ${COURT.paintR} ${COURT.ftY} L ${COURT.paintR} ${COURT.baselineY} L 340 ${COURT.basketY} A ${COURT.restrictedR} ${COURT.restrictedR} 0 0 0 260 ${COURT.basketY} L ${COURT.paintL} ${COURT.baselineY} Z`,
    labelX: 300,
    labelY: 334,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 224, y: 296, w: 152, h: 128 },
  },
  {
    id: "rim",
    name: "At Rim",
    path: `M ${COURT.paintL} ${COURT.baselineY} L 260 ${COURT.basketY} A ${COURT.restrictedR} ${COURT.restrictedR} 0 0 1 340 ${COURT.basketY} L ${COURT.paintR} ${COURT.baselineY} Z`,
    labelX: 300,
    labelY: 416,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 264, y: 398, w: 72, h: 46 },
  },
];

/** Thin orange court markings — rendered above zone fills */
export function buildCourtMarkings(): {
  baseline: string;
  sidelines: string;
  paint: string;
  ftLine: string;
  ftSemicircle: string;
  restrictedArc: string;
  backboard: string;
  threePoint: string;
} {
  const { basketX, basketY, baselineY, sidelineL, sidelineR, topY, paintL, paintR, ftY, ftCircleR, restrictedR, threeR, threeCornerLX, threeCornerRX, threeCornerY } = COURT;

  return {
    baseline: `M ${sidelineL} ${baselineY} L ${sidelineR} ${baselineY}`,
    sidelines: `M ${sidelineL} ${topY} L ${sidelineL} ${baselineY} M ${sidelineR} ${topY} L ${sidelineR} ${baselineY}`,
    paint: `M ${paintL} ${ftY} L ${paintL} ${baselineY} L ${paintR} ${baselineY} L ${paintR} ${ftY}`,
    ftLine: `M ${paintL} ${ftY} L ${paintR} ${ftY}`,
    ftSemicircle: `M ${basketX - ftCircleR} ${ftY} A ${ftCircleR} ${ftCircleR} 0 0 1 ${basketX + ftCircleR} ${ftY}`,
    restrictedArc: `M ${basketX - restrictedR} ${basketY} A ${restrictedR} ${restrictedR} 0 0 1 ${basketX + restrictedR} ${basketY}`,
    backboard: `M ${basketX - 18} ${basketY + 8} L ${basketX + 18} ${basketY + 8}`,
    threePoint: `M ${threeCornerLX} ${baselineY} L ${threeCornerLX} ${threeCornerY} A ${threeR} ${threeR} 0 0 1 ${threeCornerRX} ${threeCornerY} L ${threeCornerRX} ${baselineY}`,
  };
}

export const ZONE_BY_ID = Object.fromEntries(
  SHOT_ZONE_LAYOUTS.map((zone) => [zone.id, zone])
) as Record<ShotZoneId, ShotZoneLayout>;
