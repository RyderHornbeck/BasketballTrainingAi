// Full-screen realtime voice coach. Audio-only — listens continuously while open.

import { Text } from "@/components/Text";
import { CoachOrb } from "@/components/CoachOrb";
import { useAuth } from "@/hooks/useAuth";
import { NoConnectionBanner } from "@/components/NoConnectionBanner";
import { useCoach } from "@/hooks/useCoach";
import { getCoachProfile } from "@/lib/coachProfiles";
import { useTheme } from "@/hooks/useTheme";
import { actionHaptic } from "@/lib/haptics";
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CoachOverlayProps {
  onClose: () => void;
  dayId: string | null;
  dayTitle: string | null;
}

const CLOUD_ORB_SIZE = 150;

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
    toggleMute,
    toggleTimer,
    audioLevels,
    sttProvider,
  } = useCoach(dayId);

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
    };
  }, []);

  useEffect(() => {
    if (hasUserTranscript) userTranscriptOpacity.setValue(1);
  }, [hasUserTranscript, userTranscriptOpacity]);

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
    void stopSession();
    onClose();
  };

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

  return (
    <Modal visible animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <NoConnectionBanner />
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, { color: colors.text }]}>{coachProfile.name}</Text>
            {dayTitle ? (
              <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {dayTitle}
              </Text>
            ) : null}
          </View>

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

          <Pressable
            onPress={handleClose}
            style={[styles.closeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
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
              {sttProvider ? (
                <Text style={[styles.providerLabel, { color: colors.textSecondary }]}>
                  {sttProvider === "deepgram" ? "Deepgram" : "AssemblyAI"}
                </Text>
              ) : null}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 24,
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
  providerLabel: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
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
