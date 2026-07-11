// Full-screen realtime voice coach. Audio-only — no transcript.
// Wake phrase ("Hey Coach") or tap orb activates a short-lived Realtime session.

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
    wakeHint,
    timerRunning,
    elapsedSeconds,
    activateCoach,
    shutdownCoach,
    toggleTimer,
  } = useCoach(dayId);

  useEffect(() => {
    void activateKeepAwakeAsync("coach-overlay");
    return () => {
      deactivateKeepAwake("coach-overlay");
      void shutdownCoach();
    };
  }, [shutdownCoach]);

  useEffect(() => {
    if (status === "wake_word_listening" || status === "listening" || status === "follow_up") {
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
    void shutdownCoach();
    onClose();
  };

  const statusLabel =
    status === "connecting"
      ? "Connecting to your coach…"
      : status === "listening"
        ? "Listening"
        : status === "thinking"
          ? "Thinking"
          : status === "speaking"
            ? "Coach is talking"
            : status === "follow_up"
              ? "Still here — ask a follow-up"
              : status === "wake_word_listening"
                ? 'Say "Hey Coach" or tap below'
                : status === "disconnecting"
                  ? "Disconnecting…"
                  : status === "error"
                    ? "Tap to retry"
                    : "Tap to talk";

  const centerColor =
    status === "speaking"
      ? colors.accentMuted
      : status === "listening" || status === "follow_up"
        ? colors.accent
        : status === "connecting" || status === "thinking"
          ? colors.cardAlt
          : colors.card;

  const centerIcon =
    status === "connecting" || status === "thinking"
      ? null
      : status === "speaking"
        ? "volume-high"
        : status === "error"
          ? "mic-off"
          : "mic";

  const orbDisabled = status === "connecting" || status === "disconnecting" || status === "thinking";

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
            <Text style={[styles.timerText, { color: colors.text }]}>{formatTimer(elapsedSeconds)}</Text>
          </Pressable>

          <Pressable
            onPress={handleClose}
            style={[styles.closeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.center}>
          {error ? (
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          ) : null}
          {wakeHint ? (
            <Text style={[styles.hint, { color: colors.textSecondary, marginBottom: 8 }]}>{wakeHint}</Text>
          ) : null}
          <Text style={[styles.statusLabel, { color: colors.text }]}>{statusLabel}</Text>

          <Pressable onPress={() => void activateCoach()} disabled={orbDisabled}>
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

          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {status === "wake_word_listening"
              ? 'Say "Hey Coach" when you need help, or tap the circle'
              : status === "follow_up"
                ? "You have about 25 seconds for a follow-up"
                : status === "error"
                  ? "Tap the circle to try again"
                  : "Short answers only — coach disconnects when idle"}
          </Text>
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
  errorText: {
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
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
