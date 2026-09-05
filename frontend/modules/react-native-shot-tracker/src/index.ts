import { NitroModules } from "react-native-nitro-modules";
import type { ShotTracker as ShotTrackerSpec } from "./ShotTracker.nitro";

export type {
  Detection,
  NormalizedRect,
  Point,
  ProcessResult,
  ShotEvent,
  ShotResult,
  ShotTracker as ShotTrackerSpec,
  TrackerConfiguration,
  TrackerDiagnostic,
  TrackerState,
  TrackerUpdate,
} from "./ShotTracker.nitro";

/**
 * Synchronous Nitro HybridObject. `process(frame)` must run inside
 * VisionCamera's `useAsyncRunner`; it intentionally returns `undefined`
 * between sparse updates.
 */
export const ShotTracker =
  NitroModules.createHybridObject<ShotTrackerSpec>("ShotTracker");
