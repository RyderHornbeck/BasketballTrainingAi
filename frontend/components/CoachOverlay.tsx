// Full-screen realtime voice coach. Audio-only — listens continuously while open.

import { Text } from "@/components/Text";
import { useCoach } from "@/hooks/useCoach";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CoachOverlayProps {
  onClose: () => void;
  dayId: string | null;
  dayTitle: string | null;
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CoachOverlay({ onClose, dayId, dayTitle }: CoachOverlayProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(1)).current;

  const {
    status,
    error,
    timerRunning,
    elapsedSeconds,
    timerDurationSeconds,
    dailyBudget,
    startSession,
    stopSession,
    toggleMute,
    toggleTimer,
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
  const remainingBudgetPercent = Math.round(remainingBudgetProgress * 100);

  useEffect(() => {
    void activateKeepAwakeAsync("coach-overlay");
    return () => {
      deactivateKeepAwake("coach-overlay");
    };
  }, []);

  useEffect(() => {
    if (status === "listening") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
    pulse.setValue(1);
  }, [status, pulse]);

  const handleClose = () => {
    void stopSession();
    onClose();
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

  const centerColor = budgetExhausted
    ? colors.cardAlt
    : status === "speaking"
      ? colors.accentMuted
      : status === "listening"
        ? colors.accent
        : status === "connecting" || status === "thinking"
          ? colors.cardAlt
          : colors.card;

  const centerIcon = budgetExhausted
    ? "hourglass-outline"
    : status === "connecting" || status === "thinking"
      ? null
      : status === "speaking"
        ? "volume-high"
        : status === "muted" || status === "error"
          ? "mic-off"
          : "mic";

  const orbDisabled =
    budgetExhausted || status === "connecting" || status === "disconnecting" || status === "thinking";

  const hint = budgetExhausted
    ? "Your 75¢ coach credit refills tomorrow. You can still use the timer and log drills manually."
    : status === "muted"
      ? "Tap the circle to turn the mic back on"
      : status === "error"
        ? "Tap the circle to reconnect"
        : "Just talk — your coach is listening";

  return (
    <Modal visible animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, { color: colors.text }]}>Coach</Text>
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
                : `${remainingBudgetPercent}% left today`}
            </Text>
          </View>
        ) : null}

        <View style={styles.center}>
          <Text style={[styles.statusLabel, { color: colors.text }]}>{statusLabel}</Text>

          <Pressable
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
            <Animated.View
              style={[
                styles.coachOrb,
                {
                  backgroundColor: centerColor,
                  shadowColor: colors.accent,
                  transform: [{ scale: pulse }],
                },
              ]}
            >
              {status === "connecting" || status === "thinking" ? (
                <ActivityIndicator size="large" color={colors.accent} />
              ) : centerIcon ? (
                <Ionicons name={centerIcon} size={52} color="#FFFFFF" />
              ) : null}
            </Animated.View>
          </Pressable>

          <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
        </View>
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
  statusLabel: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 36,
    letterSpacing: -0.3,
  },
  coachOrb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 14,
  },
  hint: {
    fontSize: 14,
    marginTop: 28,
    textAlign: "center",
    lineHeight: 20,
  },
});
