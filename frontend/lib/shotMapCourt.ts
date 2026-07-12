/**
 * Half-court shot-map coordinate system (viewBox 600 × 520).
 *
 * Origin is top-left. Y increases downward.
 * The basket sits near the bottom center; the baseline is the bottom edge.
 * All zone paths and court markings share these constants.
 */
export const COURT_VIEWBOX = { width: 600, height: 520 } as const;

export const COURT = {
  /** Basket / hoop center */
  basketX: 300,
  basketY: 478,
  /** Court boundaries */
  baselineY: 498,
  sidelineL: 50,
  sidelineR: 550,
  topY: 70,
  /** Paint / key */
  paintL: 220,
  paintR: 380,
  ftY: 310,
  ftCircleR: 58,
  /** Restricted area arc radius */
  restrictedR: 34,
  /** Three-point arc radius (measured from basket center) */
  threeR: 238,
  /** Corner three: straight-line segment meets the arc at this Y */
  threeCornerY: 358,
  threeCornerLX: 78,
  threeCornerRX: 522,
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
    labelX: 58,
    labelY: 438,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 52, y: 362, w: 24, h: 132 },
  },
  {
    id: "right_corner_three",
    name: "Right Corner 3",
    path: `M ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.sidelineR} ${COURT.threeCornerY} L ${COURT.sidelineR} ${COURT.baselineY} L ${COURT.threeCornerRX} ${COURT.baselineY} Z`,
    labelX: 542,
    labelY: 438,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 524, y: 362, w: 24, h: 132 },
  },
  {
    id: "left_wing_three",
    name: "Left Wing 3",
    path: `M ${COURT.sidelineL} ${COURT.topY} L ${COURT.sidelineL} ${COURT.threeCornerY} L ${COURT.threeCornerLX} ${COURT.threeCornerY} A ${COURT.threeR} ${COURT.threeR} 0 0 1 168 268 L ${COURT.sidelineL} 268 Z`,
    labelX: 108,
    labelY: 318,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 54, y: 72, w: 112, h: 282 },
  },
  {
    id: "right_wing_three",
    name: "Right Wing 3",
    path: `M ${COURT.sidelineR} ${COURT.topY} L ${COURT.sidelineR} ${COURT.threeCornerY} L ${COURT.threeCornerRX} ${COURT.threeCornerY} A ${COURT.threeR} ${COURT.threeR} 0 0 0 432 268 L ${COURT.sidelineR} 268 Z`,
    labelX: 492,
    labelY: 318,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 434, y: 72, w: 112, h: 282 },
  },
  {
    id: "top_of_key_three",
    name: "Top of Key 3",
    path: `M 168 268 A ${COURT.threeR} ${COURT.threeR} 0 0 1 ${THREE_APEX.x} ${THREE_APEX.y} A ${COURT.threeR} ${COURT.threeR} 0 0 1 432 268 L 432 ${COURT.topY} L 168 ${COURT.topY} Z`,
    labelX: 300,
    labelY: 188,
    labelSize: 12,
    ratioSize: 9,
    dotBounds: { x: 172, y: 72, w: 256, h: 196 },
  },
  {
    id: "left_midrange",
    name: "Left Mid",
    path: `M 168 268 A ${COURT.threeR} ${COURT.threeR} 0 0 1 ${COURT.threeCornerLX} ${COURT.threeCornerY} L ${COURT.paintL} 372 L ${COURT.paintL} ${COURT.ftY} L 188 ${COURT.ftY} A ${COURT.ftCircleR} ${COURT.ftCircleR} 0 0 1 168 268 Z`,
    labelX: 168,
    labelY: 338,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 120, y: 272, w: 98, h: 96 },
  },
  {
    id: "right_midrange",
    name: "Right Mid",
    path: `M 432 268 A ${COURT.threeR} ${COURT.threeR} 0 0 0 ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.paintR} 372 L ${COURT.paintR} ${COURT.ftY} L 412 ${COURT.ftY} A ${COURT.ftCircleR} ${COURT.ftCircleR} 0 0 0 432 268 Z`,
    labelX: 432,
    labelY: 338,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 382, y: 272, w: 98, h: 96 },
  },
  {
    id: "center_midrange",
    name: "Center Mid",
    path: `M 188 ${COURT.ftY} L 412 ${COURT.ftY} A ${COURT.ftCircleR} ${COURT.ftCircleR} 0 0 1 300 ${COURT.ftY - COURT.ftCircleR} A ${COURT.ftCircleR} ${COURT.ftCircleR} 0 0 1 188 ${COURT.ftY} Z`,
    labelX: 300,
    labelY: 278,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 220, y: 248, w: 160, h: 58 },
  },
  {
    id: "left_short_range",
    name: "Left Short",
    path: `M ${COURT.threeCornerLX} ${COURT.threeCornerY} L ${COURT.paintL} 372 L ${COURT.paintL} ${COURT.baselineY} L ${COURT.threeCornerLX} ${COURT.baselineY} Z`,
    labelX: 142,
    labelY: 438,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 82, y: 362, w: 136, h: 132 },
  },
  {
    id: "right_short_range",
    name: "Right Short",
    path: `M ${COURT.threeCornerRX} ${COURT.threeCornerY} L ${COURT.paintR} 372 L ${COURT.paintR} ${COURT.baselineY} L ${COURT.threeCornerRX} ${COURT.baselineY} Z`,
    labelX: 458,
    labelY: 438,
    labelSize: 10,
    ratioSize: 8,
    dotBounds: { x: 382, y: 362, w: 136, h: 132 },
  },
  {
    id: "paint",
    name: "Paint",
    path: `M ${COURT.paintL} ${COURT.ftY} L ${COURT.paintR} ${COURT.ftY} L ${COURT.paintR} ${COURT.baselineY} L 334 ${COURT.basketY} A ${COURT.restrictedR} ${COURT.restrictedR} 0 0 0 266 ${COURT.basketY} L ${COURT.paintL} ${COURT.baselineY} Z`,
    labelX: 300,
    labelY: 408,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 224, y: 314, w: 152, h: 180 },
  },
  {
    id: "rim",
    name: "At Rim",
    path: `M 266 ${COURT.basketY} A ${COURT.restrictedR} ${COURT.restrictedR} 0 0 1 334 ${COURT.basketY} L ${COURT.paintR} ${COURT.baselineY} L ${COURT.paintL} ${COURT.baselineY} Z`,
    labelX: 300,
    labelY: 468,
    labelSize: 11,
    ratioSize: 9,
    dotBounds: { x: 268, y: 448, w: 64, h: 46 },
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
    ftSemicircle: `M ${paintL} ${ftY} A ${ftCircleR} ${ftCircleR} 0 0 0 ${paintR} ${ftY}`,
    restrictedArc: `M ${basketX - restrictedR} ${basketY} A ${restrictedR} ${restrictedR} 0 0 1 ${basketX + restrictedR} ${basketY}`,
    backboard: `M ${basketX - 18} ${basketY + 8} L ${basketX + 18} ${basketY + 8}`,
    threePoint: `M ${sidelineL} ${baselineY} L ${sidelineL} ${threeCornerY} L ${threeCornerLX} ${threeCornerY} A ${threeR} ${threeR} 0 0 1 ${threeCornerRX} ${threeCornerY} L ${sidelineR} ${threeCornerY} L ${sidelineR} ${baselineY}`,
  };
}

export const ZONE_BY_ID = Object.fromEntries(
  SHOT_ZONE_LAYOUTS.map((zone) => [zone.id, zone])
) as Record<ShotZoneId, ShotZoneLayout>;
