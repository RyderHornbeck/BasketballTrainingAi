// Full-screen realtime voice coach. Audio-only — listens continuously while open.

import { Text } from "@/components/Text";
import { CoachOrb } from "@/components/CoachOrb";
import { VideoCoachView } from "@/components/VideoCoachView";
import { useAuth } from "@/hooks/useAuth";
import { NoConnectionBanner } from "@/components/NoConnectionBanner";
import { useCoach } from "@/hooks/useCoach";
import { getCoachProfile } from "@/lib/coachProfiles";
import { useTheme } from "@/hooks/useTheme";
import { actionHaptic } from "@/lib/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Updates from "expo-updates";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CoachOverlayProps {
  onClose: () => void;
  dayId: string | null;
  dayTitle: string | null;
}

const CLOUD_ORB_SIZE = 150;
const VOICE_COACH_INTRO_DISMISSED_KEY = "hoopplan.coach_intro.voice.v1";
const VIDEO_COACH_INTRO_DISMISSED_KEY = "hoopplan.coach_intro.video.v1";

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function CoachIntroScreen({
  mode,
  dark,
  athleteName,
  backgroundColor = "#05070A",
  onContinue,
  onDontShowAgain,
}: {
  mode: "voice" | "video";
  dark: boolean;
  athleteName: string;
  backgroundColor?: string;
  onContinue: () => void;
  onDontShowAgain: () => void;
}) {
  const copy = mode === "video"
    ? [
        "Place your phone on either wing behind the 3-point line with the ball and hoop visible. For best tracking, use a well-lit court and an orange/brown ball.",
        "Wait for Court Coach to connect and start speaking through your headphones. Your coach will guide the workout.",
        "Use your voice to control timers for ball-handling and other timed exercises. The camera tracks shooting and finishing; use your voice to correct Coach if needed.",
      ]
    : [
        `Hey ${athleteName}! Wait for Court Coach to connect and start speaking through your headphones. Your coach will guide the workout.`,
        "Say “make” or “miss” after shooting and finishing attempts. Voice-activated timers run ball-handling, conditioning, and defense.",
        "Court Coach can make mistakes—use your voice to correct Coach if needed.",
      ];
  const foreground = dark ? "#FFFFFF" : "#0F1720";

  return (
    <View style={[styles.introScreen, { backgroundColor }]}>
      <View
        style={[
          styles.introGlass,
          mode === "video" && styles.introGlassVideo,
          { backgroundColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)" },
        ]}
      >
        <View style={[styles.introCopy, mode === "video" && styles.introCopyVideo]}>
          {copy.map((line) => (
            <Text
              key={line}
              style={[
                styles.introText,
                mode === "video" && styles.introTextVideo,
                { color: foreground, fontSize: mode === "video" ? 17 : 18 },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>
        <View style={[styles.introActions, mode === "video" && styles.introActionsVideo]}>
          <Pressable onPress={onContinue} style={styles.introContinue}>
            <Text style={styles.introContinueText}>Continue</Text>
          </Pressable>
          <Pressable onPress={onDontShowAgain} hitSlop={10} style={styles.introDontShow}>
            <Text style={[styles.introDontShowText, { color: foreground }]}>
              Don’t show this again
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function CoachOverlay({ onClose, dayId, dayTitle }: CoachOverlayProps) {
  const { colors } = useTheme();
  const { profile } = useAuth();
  const coachProfile = getCoachProfile(profile?.realtime_coach_voice);
  const insets = useSafeAreaInsets();
  const [userTranscriptOpacity] = useState(() => new Animated.Value(1));
  const [coachTranscriptOpacity] = useState(() => new Animated.Value(1));
  const [pulse] = useState(() => new Animated.Value(1));
  const [thinkingDots] = useState(() => [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);
  const [videoAwaitingConnection, setVideoAwaitingConnection] =
    useState(true);
  const [showVoiceIntro, setShowVoiceIntro] = useState(true);
  const [showVideoIntro, setShowVideoIntro] = useState(true);
  const windowDimensions = useWindowDimensions();
  // The window geometry, rather than the physical device orientation, tells us
  // whether UIKit has actually completed the portrait-to-landscape transition.
  const videoInterfaceIsLandscape =
    windowDimensions.width > windowDimensions.height;
  const videoCoachEnabled =
    Platform.OS === "ios" &&
    (__DEV__ || Updates.channel === "staging") &&
    process.env.EXPO_PUBLIC_VIDEO_COACH_ENABLED !== "0";
  // Profile settings update preferred_name; full_name is the sign-in name and
  // can intentionally remain unchanged.
  const athleteName =
    profile?.preferred_name?.trim().split(/\s+/)[0] ||
    profile?.full_name?.trim().split(/\s+/)[0] ||
    "there";
  const coachConnectionEnabled = useMemo(
    () => ({ voice: !showVoiceIntro, video: !showVideoIntro }),
    [showVideoIntro, showVoiceIntro],
  );

  const {
    status,
    error,
    timerRunning,
    elapsedSeconds,
    timerDurationSeconds,
    userTranscript,
    coachTranscript,
    coachTranscriptFadeVersion,
    dailyBudget,
    startSession,
    stopSession,
    suspendSessionForModeTransition,
    toggleMute,
    toggleTimer,
    audioLevels,
    shotInputMode,
    videoHudState,
    setShotInputMode,
    recordShotResult,
  } = useCoach(
    dayId,
    videoCoachEnabled ? "video" : "voice",
    coachConnectionEnabled,
  );
  const budgetExhausted = status === "budget_exhausted";
  const timerDisplaySeconds =
    timerDurationSeconds == null
      ? elapsedSeconds
      : Math.max(0, timerDurationSeconds - elapsedSeconds);
  const remainingBudgetProgress =
    dailyBudget && dailyBudget.budgetUsd > 0
      ? Math.max(0, Math.min(1, dailyBudget.remainingUsd / dailyBudget.budgetUsd))
      : 0;
  // Never round a non-zero spend back up to "100% left".
  const remainingBudgetPercent = Math.floor(remainingBudgetProgress * 100);
  const hasUserTranscript = Boolean(userTranscript);
  const hasCoachTranscript = Boolean(coachTranscript);

  useEffect(() => {
    void AsyncStorage.getItem(VOICE_COACH_INTRO_DISMISSED_KEY)
      .then((value) => setShowVoiceIntro(value !== "1"))
      .catch(() => setShowVoiceIntro(true));
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(VIDEO_COACH_INTRO_DISMISSED_KEY)
      .then((value) => setShowVideoIntro(value !== "1"))
      .catch(() => setShowVideoIntro(true));
  }, []);

  const dismissCoachIntro = useCallback((mode: "voice" | "video", hideForever: boolean) => {
    actionHaptic();
    if (mode === "voice") {
      setShowVoiceIntro(false);
      if (hideForever) void AsyncStorage.setItem(VOICE_COACH_INTRO_DISMISSED_KEY, "1");
      return;
    }
    setShowVideoIntro(false);
    if (hideForever) void AsyncStorage.setItem(VIDEO_COACH_INTRO_DISMISSED_KEY, "1");
  }, []);

  useEffect(() => {
    if (hasUserTranscript) userTranscriptOpacity.setValue(1);
  }, [hasUserTranscript, userTranscriptOpacity]);

  useEffect(() => {
    const scale =
      status === "listening" ? 1 + Math.min(1, audioLevels.microphone) * 0.3 : 1;
    Animated.timing(pulse, {
      toValue: scale,
      duration: 110,
      useNativeDriver: true,
    }).start();
  }, [audioLevels.microphone, pulse, status]);

  useEffect(() => {
    if (status !== "thinking") {
      thinkingDots.forEach((dot) => dot.setValue(0));
      return;
    }

    const animation = Animated.loop(
      Animated.stagger(
        120,
        thinkingDots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: -6, duration: 180, useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0, duration: 180, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [status, thinkingDots]);

  useEffect(() => {
    void activateKeepAwakeAsync("coach-overlay");
    return () => {
      deactivateKeepAwake("coach-overlay");
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (shotInputMode === "video") {
      // Video Coach is intentionally not locked: the player must physically
      // rotate first. The gate below keeps every camera/Coach UI element off
      // screen until UIKit reports that landscape transition.
      void ScreenOrientation.unlockAsync().catch(() => setShotInputMode("voice"));
      return;
    }

    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => undefined);
  }, [setShotInputMode, shotInputMode]);

  useEffect(() => {
    if (
      shotInputMode !== "video" ||
      !videoAwaitingConnection ||
      showVideoIntro ||
      !videoInterfaceIsLandscape
    ) {
      return;
    }

    // Let the landscape window render before starting audio. Besides avoiding
    // a synchronous effect-state update, this prevents an old Voice session
    // from racing the newly mounted Video Coach gate.
    const connectionTimer = setTimeout(() => {
      setVideoAwaitingConnection(false);
      void startSession();
    }, 0);
    return () => clearTimeout(connectionTimer);
  }, [
    shotInputMode,
    startSession,
    videoAwaitingConnection,
    showVideoIntro,
    videoInterfaceIsLandscape,
  ]);

  useEffect(() => {
    if (hasCoachTranscript) coachTranscriptOpacity.setValue(1);
  }, [hasCoachTranscript, coachTranscriptOpacity]);

  useEffect(() => {
    if (!coachTranscript || coachTranscriptFadeVersion === 0) return;
    Animated.parallel([
      Animated.timing(userTranscriptOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(coachTranscriptOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    coachTranscript,
    coachTranscriptFadeVersion,
    coachTranscriptOpacity,
    userTranscriptOpacity,
  ]);

  const handleClose = () => {
    setVideoAwaitingConnection(false);
    setShotInputMode("voice");
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => undefined);
    void stopSession();
    onClose();
  };

  const handleSwitchToVideo = async () => {
    actionHaptic();
    // Fully release the Voice transport before mounting the landscape camera
    // and allowing the Video connection gate to acquire startup ownership.
    await suspendSessionForModeTransition();
    setVideoAwaitingConnection(true);
    setShotInputMode("video");
  };

  const handleSwitchToVoice = async () => {
    actionHaptic();
    setVideoAwaitingConnection(false);
    await suspendSessionForModeTransition();
    setShotInputMode("voice");
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => undefined);
    void startSession();
  };

  const handleVideoShot = useCallback(
    (result: "make" | "miss", eventId: string) => {
      void recordShotResult(result, "video", eventId);
    },
    [recordShotResult],
  );

  const handleOpenGuide = () => {
    actionHaptic();
    void stopSession();
    onClose();
    requestAnimationFrame(() => router.push("/coach-guide"));
  };

  const statusLabel = budgetExhausted
    ? "Coach time used up"
    : status === "connecting"
      ? "Connecting to your coach…"
      : status === "listening"
        ? "Listening"
        : status === "thinking"
          ? "Thinking"
          : status === "speaking"
            ? "Coach is talking"
            : status === "muted"
              ? "Mic off — tap to listen"
              : status === "disconnecting"
                ? "Disconnecting…"
                : status === "error"
                  ? "Tap to retry"
                  : "Starting coach…";

  const isErrorState = status === "error";
  const isRedState =
    budgetExhausted || status === "muted" || status === "disconnecting" || status === "error";
  const orbState =
    status === "idle" ||
    status === "connecting" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking" ||
    status === "error"
      ? status
      : "error";
  const orbVolume = status === "speaking" ? audioLevels.tts : audioLevels.microphone;

  const orbDisabled =
    budgetExhausted || status === "connecting" || status === "disconnecting" || status === "thinking";

  const hint = budgetExhausted
    ? "Your coach credit refills tomorrow. You can still use the timer and log drills manually."
    : status === "muted"
      ? "Tap the circle to turn the mic back on"
      : status === "error"
        ? "Tap the circle to reconnect"
        : "Just talk — your coach is listening";

  if (shotInputMode === "video") {
    const videoPrimaryMetric = timerRunning || videoHudState?.isTimed
      ? formatTimer(timerDisplaySeconds)
      : `${videoHudState?.shootingPercentage ?? 0}%`;
    return (
      <Modal
        // On iOS, supportedOrientations is captured by the presented native
        // view controller. A Voice → Video switch therefore needs a fresh
        // controller; otherwise the original portrait-only Voice modal keeps
        // the window portrait and the Video landscape gate can never open.
        key="video-coach-modal"
        visible
        animationType="none"
        presentationStyle="fullScreen"
        supportedOrientations={[
          "portrait",
          "landscape-left",
          "landscape-right",
        ]}
        onRequestClose={handleClose}
      >
        {showVideoIntro && videoInterfaceIsLandscape ? (
          <CoachIntroScreen
            mode="video"
            dark
            athleteName={athleteName}
            onContinue={() => dismissCoachIntro("video", false)}
            onDontShowAgain={() => dismissCoachIntro("video", true)}
          />
        ) : (
          <VideoCoachView
            status={status}
            userTranscript={userTranscript}
            coachTranscript={coachTranscript}
            coachTranscriptFadeVersion={coachTranscriptFadeVersion}
            hudState={videoHudState}
            primaryMetric={videoPrimaryMetric}
            coachVolume={audioLevels.tts}
            interfaceIsLandscape={videoInterfaceIsLandscape}
            onClose={handleClose}
            onSwitchToVoice={handleSwitchToVoice}
            onShot={handleVideoShot}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      // Keep this distinct from the Video modal so changing modes remounts the
      // native controller rather than merely replacing its React children.
      key="voice-coach-modal"
      visible
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {showVoiceIntro ? (
          <CoachIntroScreen
            mode="voice"
            dark={colors.text === "#FFFFFF"}
            athleteName={athleteName}
            backgroundColor={colors.background}
            onContinue={() => dismissCoachIntro("voice", false)}
            onDontShowAgain={() => dismissCoachIntro("voice", true)}
          />
        ) : null}
        <NoConnectionBanner />
        <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
          <View style={styles.headerTopRow}>
            <Pressable
              onPress={handleClose}
              style={[styles.closeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.headerContentRow}>
            <View style={styles.headerLeft}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {coachProfile.name}
              </Text>
              {dayTitle ? (
                <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {dayTitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerActions}>
            <Pressable
              onPress={toggleTimer}
              style={[styles.timerChip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons
                name={timerRunning ? "pause" : "play"}
                size={14}
                color={colors.accent}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.timerText, { color: colors.text }]}>
                {formatTimer(timerDisplaySeconds)}
              </Text>
            </Pressable>
            {videoCoachEnabled ? (
            <Pressable
              accessibilityLabel="Switch to Voice and Video Coach"
              onPress={handleSwitchToVideo}
              style={[
                styles.videoButton,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="videocam" size={17} color={colors.accent} />
              <Text style={[styles.videoButtonText, { color: colors.text }]}>
                Video
              </Text>
            </Pressable>
            ) : null}
            </View>
          </View>
        </View>

        {dailyBudget ? (
          <View style={styles.budgetRow}>
            <View style={[styles.budgetTrack, { backgroundColor: colors.card }]}>
              <View
                style={[
                  styles.budgetFill,
                  {
                    backgroundColor: budgetExhausted ? colors.textMuted : colors.accent,
                    width: `${remainingBudgetPercent}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.budgetLabel, { color: colors.textSecondary }]}>
              {budgetExhausted
                ? "Today's coach credit is used up"
                : `${remainingBudgetPercent}% coach time left today`}
            </Text>
          </View>
        ) : null}
        <View style={styles.center}>
          <View style={styles.transcriptSlot} pointerEvents="none">
            {userTranscript ? (
              <Animated.View style={{ opacity: userTranscriptOpacity }}>
                <Text
                  style={[styles.transcriptLine, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {userTranscript}
                </Text>
              </Animated.View>
            ) : null}
            {coachTranscript ? (
              <Animated.View style={{ opacity: coachTranscriptOpacity }}>
                <Text
                  style={[styles.transcriptLine, { color: colors.text }]}
                  numberOfLines={4}
                  ellipsizeMode="tail"
                >
                  {coachTranscript}
                </Text>
              </Animated.View>
            ) : null}
          </View>
          <View style={[styles.coachControls, !isErrorState && styles.cloudControls]}>
            {status === "thinking" ? (
              <View style={styles.thinkingStatus}>
                <Text style={[styles.statusLabel, styles.thinkingLabel, { color: colors.text }]}>
                  {statusLabel}
                </Text>
                <View style={styles.thinkingDots} accessibilityLabel="Thinking">
                  {thinkingDots.map((dot, index) => (
                    <Animated.View
                      key={index}
                      style={[
                        styles.thinkingDot,
                        { backgroundColor: colors.text, transform: [{ translateY: dot }] },
                      ]}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <Text style={[styles.statusLabel, { color: colors.text }]}>{statusLabel}</Text>
            )}

            <Pressable
            accessibilityRole="button"
            accessibilityLabel={statusLabel}
            onPress={() => {
              if (budgetExhausted) return;
              if (status === "error" && !error?.toLowerCase().includes("limit reached")) {
                void startSession();
              } else if (!budgetExhausted) {
                toggleMute();
              }
            }}
            disabled={orbDisabled}
            >
              {status === "muted" ? (
                <Animated.View
                  style={[
                    styles.mutedOrb,
                    {
                      backgroundColor: colors.danger,
                      shadowColor: colors.danger,
                      transform: [{ scale: pulse }],
                    },
                  ]}
                >
                  <Ionicons name="mic-off" size={48} color="#FFFFFF" />
                </Animated.View>
              ) : (
                <CoachOrb
                  size={CLOUD_ORB_SIZE}
                  shadowColor={isRedState ? colors.danger : colors.accent}
                  style={{ transform: [{ scale: pulse }] }}
                  state={orbState}
                  volume={orbVolume}
                />
              )}
            </Pressable>

            <View style={styles.hints}>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Make sure headphones are connected
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={handleOpenGuide}
          hitSlop={10}
          style={({ pressed }) => [
            styles.guideLink,
            {
              bottom: insets.bottom + 10,
              borderColor: "#FFFFFF",
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Text style={[styles.guideLinkText, { color: colors.accent }]}>
            How to use Court Coach
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  introScreen: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    padding: 18,
  },
  introGlass: {
    flex: 1,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 28,
    paddingVertical: 34,
    justifyContent: "space-between",
  },
  introGlassVideo: {
    borderRadius: 30,
    paddingVertical: 20,
  },
  introCopy: {
    flex: 1,
    justifyContent: "center",
    gap: 22,
    maxWidth: 760,
    alignSelf: "center",
  },
  introCopyVideo: {
    gap: 12,
  },
  introText: {
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
    textAlign: "center",
  },
  introTextVideo: {
    lineHeight: 24,
  },
  introActions: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    gap: 16,
  },
  introActionsVideo: {
    gap: 8,
  },
  introContinue: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: "#F58220",
  },
  introContinueText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  introDontShow: {
    alignItems: "center",
    paddingVertical: 5,
  },
  introDontShowText: {
    fontSize: 14,
    fontWeight: "700",
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  headerLeft: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerContentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  budgetRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 6,
  },
  budgetTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  budgetFill: {
    height: "100%",
    borderRadius: 999,
  },
  budgetLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  providerWarning: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  timerChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  timerText: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  videoButton: {
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  videoButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  transcriptSlot: {
    position: "absolute",
    top: 24,
    left: 24,
    right: 24,
    gap: 10,
  },
  transcriptLine: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  statusLabel: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 36,
    letterSpacing: -0.3,
  },
  thinkingStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 36,
    gap: 8,
  },
  thinkingLabel: {
    marginBottom: 0,
  },
  thinkingDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  coachControls: {
    alignItems: "center",
  },
  mutedOrb: {
    width: CLOUD_ORB_SIZE,
    height: CLOUD_ORB_SIZE,
    borderRadius: CLOUD_ORB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 10,
  },
  cloudControls: {
    // Keeps the label just below a maximum-length user/Coach transcript while
    // returning the normal-sized orb to the visual center of the screen.
    transform: [{ translateY: 12 }],
  },
  hints: {
    marginTop: 28,
    gap: 4,
  },
  hint: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  guideLink: {
    position: "absolute",
    alignSelf: "center",
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  guideLinkText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
