import { Text } from "@/components/Text";
import { VideoShotMap } from "@/components/analytics/VideoShotMap";
import { CoachOrb } from "@/components/CoachOrb";
import type { VideoCoachHudState } from "@/lib/realtimeCoach";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Animated,
  Dimensions,
  type AppStateStatus,
  type NativeSyntheticEvent,
  Pressable,
  requireNativeComponent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useCameraPermission } from "react-native-vision-camera";
import type { TrackerUpdate } from "react-native-shot-tracker";

interface VideoCoachViewProps {
  status: "thinking" | "speaking" | string;
  userTranscript: string;
  coachTranscript: string;
  coachTranscriptFadeVersion: number;
  hudState: VideoCoachHudState | null;
  primaryMetric: string;
  coachVolume: number;
  interfaceIsLandscape: boolean;
  onClose: () => void;
  onSwitchToVoice: () => void;
  onShot: (result: "make" | "miss", eventId: string) => void;
}

const BOX_STROKE = 1.5;
const OVERLAY_CONFIDENCE_THRESHOLD = 0.5;
const NATIVE_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

function percentageColor(percentage: number, attempts: number): string {
  if (attempts <= 0) return "#FFFFFF";
  if (percentage >= 80) return "#22C55E";
  if (percentage >= 50) return "#58A86C";
  if (percentage >= 30) return "#E8A848";
  return "#D66058";
}

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
  intensity?: number;
  tintColor?: string;
}

function GlassSurface({
  children,
  style,
  interactive = false,
  intensity = 58,
  tintColor = "rgba(18, 22, 29, 0.18)",
}: GlassSurfaceProps) {
  if (NATIVE_GLASS_AVAILABLE) {
    return (
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={[styles.glassSurface, style]}
        tintColor={tintColor}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <BlurView
      intensity={intensity}
      tint="systemThinMaterialDark"
      style={[styles.glassSurface, styles.blurSurface, style]}
    >
      {children}
    </BlurView>
  );
}

type ViewTrackerUpdate = TrackerUpdate;
type NativeTrackerEvent = TrackerUpdate & {
  shot?: { id: string; result: "make" | "miss" };
};
type LocalCoreMLCameraProps = {
  style: StyleProp<ViewStyle>;
  isActive: boolean;
  ballConfidence: number;
  trackRim: boolean;
  onTrackerEvent: (
    event: NativeSyntheticEvent<NativeTrackerEvent>,
  ) => void;
  onModelStatus?: (event: NativeSyntheticEvent<{ message?: string }>) => void;
  onCameraStatus?: (event: NativeSyntheticEvent<{ state: string }>) => void;
};
const LocalCoreMLCamera = requireNativeComponent<LocalCoreMLCameraProps>(
  "LocalCoreMLCameraView",
);

function TrackingOverlay({
  update,
  width,
  height,
}: {
  update: ViewTrackerUpdate | null;
  width: number;
  height: number;
}) {
  // Keep both visible rim boxes aligned with the same stabilized rectangle
  // used by native make/miss geometry.
  const rim = update?.activeRim ?? (
    update?.rim && update.rim.confidence >= OVERLAY_CONFIDENCE_THRESHOLD
      ? update.rim
      : undefined
  );
  const ball =
    update?.ball && update.ball.confidence >= OVERLAY_CONFIDENCE_THRESHOLD
      ? update.ball
      : undefined;
  const points = useMemo(
    () =>
      update?.trajectory
        .map((point) => `${point.x * width},${point.y * height}`)
        .join(" ") ?? "",
    [height, update?.trajectory, width],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {rim ? (
        <>
          <View
            style={[
              styles.trackingBox,
              {
                borderColor: "#2F8CFF",
                left: rim.x * width,
                top: rim.y * height,
                width: rim.width * width,
                height: rim.height * height,
              },
            ]}
          />
        </>
      ) : null}
      {ball ? (
        <View
          style={[
            styles.trackingBox,
            {
              borderColor: "#FFD21C",
              left: ball.x * width,
              top: ball.y * height,
              width: ball.width * width,
              height: ball.height * height,
            },
          ]}
        />
      ) : null}
      {points ? (
        <Svg style={StyleSheet.absoluteFill}>
          <Polyline
            points={points}
            fill="none"
            stroke="#FFD21C"
            strokeWidth={BOX_STROKE}
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      ) : null}
    </View>
  );
}

export function VideoCoachView({
  status,
  userTranscript,
  coachTranscript,
  coachTranscriptFadeVersion,
  hudState,
  primaryMetric,
  coachVolume,
  interfaceIsLandscape,
  onClose,
  onSwitchToVoice,
  onShot,
}: VideoCoachViewProps) {
  const {
    hasPermission,
    canRequestPermission,
    requestPermission,
  } = useCameraPermission();
  const [trackerUpdate, setTrackerUpdate] =
    useState<ViewTrackerUpdate | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [visibleCoachText, setVisibleCoachText] = useState("");
  const visibleCoachTextRef = useRef("");
  const [startupGreetingAudible, setStartupGreetingAudible] = useState(false);
  const [transcriptOpacity] = useState(() => new Animated.Value(1));
  const [viewport, setViewport] = useState(Dimensions.get("window"));
  const [coachOrbScale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const dimensionsSubscription = Dimensions.addEventListener("change", ({ window }) =>
      setViewport(window)
    );
    return () => {
      dimensionsSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const active = status === "speaking";
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(coachOrbScale, {
          toValue: active ? 1.08 + Math.min(coachVolume, 1) * 0.12 : 1.025,
          duration: active ? 280 : 920,
          useNativeDriver: true,
        }),
        Animated.timing(coachOrbScale, {
          toValue: active ? 0.94 : 0.975,
          duration: active ? 210 : 760,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [coachOrbScale, coachVolume, status]);

  useEffect(() => {
    if (hasPermission || !canRequestPermission) return;
    void requestPermission();
  }, [canRequestPermission, hasPermission, requestPermission]);

  useEffect(() => {
    if (!coachTranscript) {
      visibleCoachTextRef.current = "";
      const clearTextFrame = requestAnimationFrame(() => setVisibleCoachText(""));
      return () => cancelAnimationFrame(clearTextFrame);
    }
    transcriptOpacity.setValue(1);
    const currentText = visibleCoachTextRef.current;
    let index = currentText && coachTranscript.startsWith(currentText)
      ? currentText.length
      : 0;
    if (index === 0) {
      visibleCoachTextRef.current = "";
      setVisibleCoachText("");
    }
    const interval = setInterval(() => {
      index = Math.min(coachTranscript.length, index + 3);
      const nextText = coachTranscript.slice(0, index);
      visibleCoachTextRef.current = nextText;
      setVisibleCoachText(nextText);
      if (index >= coachTranscript.length) clearInterval(interval);
    }, 24);
    return () => clearInterval(interval);
  }, [coachTranscript, transcriptOpacity]);

  // The session can generate greeting text before its first audio packet is
  // actually playing. Keep the Video Coach in its single connecting state
  // until the greeting is audible; a failed first TTS attempt therefore never
  // flashes Thinking or a duplicate, silent greeting.
  useEffect(() => {
    if (!startupGreetingAudible && status === "speaking" && coachTranscript) {
      setStartupGreetingAudible(true);
    }
  }, [coachTranscript, startupGreetingAudible, status]);

  useEffect(() => {
    if (!coachTranscriptFadeVersion || !visibleCoachText) return;
    Animated.timing(transcriptOpacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [coachTranscriptFadeVersion, transcriptOpacity, visibleCoachText]);

  const handleTrackerEvent = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeTrackerEvent>) => {
      setTrackerUpdate(nativeEvent);
      if (nativeEvent.shot) {
        onShot(nativeEvent.shot.result, nativeEvent.shot.id);
      }
    },
    [onShot],
  );

  const exerciseName = hudState?.exerciseName || "Current exercise";
  const sideLabel =
    hudState?.sideLabel ||
    (hudState?.setNumber ? `Set ${hudState.setNumber}` : "Current set");
  const makes = hudState?.makes ?? 0;
  const attempts = hudState?.attempts ?? 0;
  const shotsLeft = hudState?.targetAttempts == null
    ? 0
    : Math.max(0, hudState.targetAttempts - attempts);
  const transcript = !startupGreetingAudible
    ? "Connecting…"
    : status === "thinking"
      ? "Thinking…"
      : visibleCoachText;
  const budgetExhausted = status === "budget_exhausted";
  const isCoachTranscript = Boolean(transcript);
  const mapWidth = Math.min(viewport.width * 0.39, (viewport.height * 0.44 * 600) / 470);
  const cameraActive =
    interfaceIsLandscape &&
    hasPermission &&
    appState === "active";

  // Do not create a camera preview, tracker overlay, or Coach UI while iOS is
  // still portrait. This prevents a portrait AVCapture connection from being
  // retained and gives the player one unambiguous action to take.
  if (!interfaceIsLandscape) {
    return (
      <View style={styles.orientationGate}>
        <Text style={styles.orientationGateText}>
          Turn your phone sideways to use Video Coach.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {hasPermission ? (
        <LocalCoreMLCamera
          style={StyleSheet.absoluteFill}
          isActive={cameraActive}
          ballConfidence={0.6}
          trackRim
          onTrackerEvent={handleTrackerEvent}
          onModelStatus={({ nativeEvent }) => {
            if (nativeEvent.message?.toLowerCase().includes("failed")) {
              setCameraError(nativeEvent.message);
            }
          }}
          onCameraStatus={({ nativeEvent }) => {
            if (nativeEvent.state.endsWith("FAILED")) {
              setCameraError("The rear camera could not start.");
            }
          }}
        />
      ) : (
        <View style={styles.cameraFallback}>
          <Text style={styles.fallbackText}>
            {!interfaceIsLandscape
              ? "Preparing landscape camera…"
              : canRequestPermission
              ? "Camera permission is required for Video Coach."
              : "Enable camera access in Settings to use Video Coach."}
          </Text>
        </View>
      )}

      <TrackingOverlay
        update={trackerUpdate}
        width={viewport.width}
        height={viewport.height}
      />

      <View style={styles.topLeft}>
        <GlassSurface interactive style={styles.roundButton}>
          <Pressable
            accessibilityLabel="Close Court Coach"
            onPress={onClose}
            style={({ pressed }) => [
              styles.buttonContent,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </GlassSurface>
        <GlassSurface interactive style={styles.modeButton}>
          <Pressable
            accessibilityLabel="Switch to Voice Coach"
            onPress={onSwitchToVoice}
            style={({ pressed }) => [
              styles.modeButtonContent,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="mic" size={16} color="#FFFFFF" />
            <Text style={styles.modeButtonText}>Voice</Text>
          </Pressable>
        </GlassSurface>
      </View>

      <View style={styles.topRight}>
        <GlassSurface intensity={70} style={styles.drillHud}>
          <Text style={styles.exercise}>{exerciseName}</Text>
          {sideLabel ? <Text style={styles.side}>{sideLabel}</Text> : null}
        </GlassSurface>
        <GlassSurface intensity={70} style={styles.statsHud}>
          {hudState?.isTimed ? (
            <View style={styles.statBlock}>
              <Text style={styles.timedSetValue}>{primaryMetric}</Text>
              <Text style={styles.statCaption}>Set {hudState.setNumber ?? "—"}</Text>
            </View>
          ) : (
            <>
              <View style={styles.statBlock}>
                <Text style={[styles.percentage, { color: percentageColor(hudState?.shootingPercentage ?? 0, attempts) }]}>
                  {primaryMetric}
                </Text>
                <Text style={styles.statCaption}>FG%</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{makes}/{attempts}</Text>
                <Text style={styles.statCaption}>Field Goals</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{shotsLeft} left</Text>
                <Text style={styles.statCaption}>Set {hudState?.setNumber ?? "—"}</Text>
              </View>
            </>
          )}
        </GlassSurface>
      </View>

      <GlassSurface intensity={48} style={styles.mapSurface}>
        <VideoShotMap logs={hudState?.shotMapLogs ?? []} width={mapWidth} />
      </GlassSurface>

      {budgetExhausted ? (
        <GlassSurface
          intensity={72}
          tintColor="rgba(169, 25, 34, 0.62)"
          style={styles.budgetBubble}
        >
          <Text style={styles.budgetText}>Your Coach credits ran out for today.</Text>
        </GlassSurface>
      ) : null}

      {transcript && !budgetExhausted ? (
        <Animated.View style={[styles.coachBubbleContainer, { opacity: transcriptOpacity }]}>
          <GlassSurface intensity={64} style={styles.coachBubble}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={styles.coachText}>
              {transcript}
            </Text>
            {isCoachTranscript ? (
              <Animated.View style={[styles.transcriptOrb, { transform: [{ scale: coachOrbScale }] }]}>
                <CoachOrb
                  size={20}
                  state={status === "thinking" ? "thinking" : "speaking"}
                  volume={coachVolume}
                />
              </Animated.View>
            ) : null}
          </GlassSurface>
        </Animated.View>
      ) : null}

      {cameraError ? (
        <GlassSurface intensity={64} style={styles.errorBubble}>
          <Text style={styles.errorText}>{cameraError}</Text>
        </GlassSurface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  glassSurface: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  blurSurface: {
    backgroundColor: "rgba(10, 13, 18, 0.24)",
  },
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  orientationGate: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  orientationGateText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  cameraFallback: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 48,
  },
  fallbackText: {
    color: "#FFFFFF",
    fontSize: 16,
    textAlign: "center",
  },
  trackingBox: {
    position: "absolute",
    borderWidth: BOX_STROKE,
  },
  topLeft: {
    position: "absolute",
    top: 16,
    left: 18,
    flexDirection: "row",
    gap: 10,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  buttonContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  modeButton: {
    height: 44,
    borderRadius: 22,
  },
  modeButtonContent: {
    flex: 1,
    paddingHorizontal: 15,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modeButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  topRight: {
    position: "absolute",
    top: 16,
    right: 18,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  drillHud: {
    justifyContent: "center",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statsHud: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 10,
  },
  percentage: {
    fontSize: 25,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  exercise: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  side: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  statBlock: {
    alignItems: "center",
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  timedSetValue: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statCaption: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
  statDivider: {
    height: 26,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  mapSurface: {
    position: "absolute",
    left: 18,
    bottom: 18,
    borderWidth: 0,
    borderRadius: 22,
    padding: 7,
  },
  coachBubbleContainer: {
    position: "absolute",
    left: "44%",
    right: 18,
    bottom: 22,
  },
  coachBubble: {
    borderRadius: 20,
    minHeight: 58,
    // Native liquid glass adapts to the moving camera image beneath it. A
    // stable base tint keeps the transcript legible instead of occasionally
    // appearing completely clear over bright court footage.
    backgroundColor: "rgba(17, 21, 28, 0.52)",
    paddingLeft: 15,
    paddingRight: 42,
    paddingVertical: 10,
    justifyContent: "center",
  },
  budgetBubble: {
    position: "absolute",
    left: "44%",
    right: 18,
    bottom: 92,
    borderRadius: 18,
    borderColor: "rgba(255, 178, 178, 0.7)",
    backgroundColor: "rgba(150, 19, 29, 0.46)",
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  budgetText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "center",
  },
  transcriptOrb: {
    position: "absolute",
    right: 13,
    top: "50%",
    marginTop: -10,
  },
  coachHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 5,
  },
  coachDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#FF8A34",
  },
  coachLabel: {
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  coachText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 19,
    textAlign: "left",
  },
  errorBubble: {
    position: "absolute",
    left: 18,
    bottom: 18,
    maxWidth: "34%",
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  errorText: {
    color: "#FFFFFF",
    fontSize: 12,
  },
});
