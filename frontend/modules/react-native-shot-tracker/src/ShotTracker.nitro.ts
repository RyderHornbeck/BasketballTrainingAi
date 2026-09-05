import type { HybridObject } from "react-native-nitro-modules";
import type { Frame } from "react-native-vision-camera";

export type ShotResult = "make" | "miss";
export type TrackerState =
  | "UNCONFIGURED"
  | "IDLE"
  | "APPROACHING"
  | "ABOVE_RIM"
  | "RIM_INTERACTION"
  | "COOLDOWN";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection extends NormalizedRect {
  confidence: number;
  label: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface TrackerUpdate {
  sequence: number;
  timestamp: number;
  state: TrackerState;
  reason: string;
  ball?: Detection;
  rim?: Detection;
  activeRim?: NormalizedRect;
  autoRim: boolean;
  stableRimFrames: number;
  trajectory: Point[];
}

export interface ShotEvent {
  id: string;
  result: ShotResult;
  timestamp: number;
  reason: string;
}

export interface TrackerDiagnostic {
  code: string;
  message: string;
  timestamp: number;
}

export interface ProcessResult {
  update?: TrackerUpdate;
  shot?: ShotEvent;
  diagnostic?: TrackerDiagnostic;
}

export interface TrackerConfiguration {
  ballConfidence: number;
  trackRim: boolean;
  updateFps: number;
}

export interface ShotTracker
  extends HybridObject<{ ios: "swift" }> {
  /** Loads and validates the bundled Core ML model synchronously. */
  initialize(): void;
  start(configuration: TrackerConfiguration): void;
  stop(): void;
  reset(): void;
  setManualRim(rim?: NormalizedRect): void;
  /**
   * Receives autonomous results, currently the real-time two-second attempt
   * timeout. Frame-driven results continue to return only from process(frame).
   */
  setResultCallback(
    callback?: (result: ProcessResult) => void,
  ): void;
  /**
   * Runs synchronous inference. Call only inside VisionCamera useAsyncRunner;
   * the return value is undefined when no sparse JS update is due.
   */
  process(frame: Frame): ProcessResult | undefined;
}
