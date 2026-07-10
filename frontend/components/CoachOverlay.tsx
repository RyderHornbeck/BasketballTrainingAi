// Full-screen voice coach overlay. Opened from the floating basketball
// button next to the tab bar. One tap on the mic starts listening, a second
// tap sends. Tapping the mic while the coach is speaking interrupts it.

import { Text } from "@/components/Text";
import { useCoach } from "@/hooks/useCoach";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CoachOverlayProps {
  visible: boolean;
  onClose: () => void;
  dayId: string | null;
  dayTitle: string | null;
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CoachOverlay({ visible, onClose, dayId, dayTitle }: CoachOverlayProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const {
    status,
    messages,
    error,
    timerRunning,
    elapsedSeconds,
    startListening,
    stopListening,
    sendNow,
    stopSpeaking,
    toggleTimer,
  } = useCoach(dayId);

  // Hands-free: mic opens as soon as the overlay does, closes with it.
  useEffect(() => {
    if (visible) {
      startListening();
    } else {
      stopSpeaking();
      stopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  const handleMicPress = () => {
    if (status === "recording") {
      sendNow(); // don't wait for the silence timeout
    } else if (status === "listening") {
      stopListening(); // mute
    } else if (status === "thinking") {
      // Request in flight; ignore taps until it resolves.
    } else {
      // idle (muted) or speaking: speaking gets interrupted inside startListening.
      startListening();
    }
  };

  const handleClose = () => {
    stopSpeaking();
    stopListening();
    onClose();
  };

  const statusLabel =
    status === "listening"
      ? "Listening — just start talking"
      : status === "recording"
        ? "Hearing you… pause when you're done"
        : status === "thinking"
          ? "Coach is thinking…"
          : status === "speaking"
            ? "Coach is talking — tap the mic to jump in"
            : "Mic is off — tap to talk";

  const micColor =
    status === "recording"
      ? colors.danger
      : status === "speaking" || status === "idle"
        ? colors.accentMuted
        : colors.accent;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
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
              {formatTimer(elapsedSeconds)}
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

        {/* Transcript */}
        <ScrollView
          ref={scrollRef}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptContent}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="basketball" size={44} color={colors.accent} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                Your coach is courtside
              </Text>
              <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                Try “What&apos;s next?”, “I made 8 of 10”, “Skip this drill”, or “How am I doing?”
              </Text>
            </View>
          ) : (
            messages.map((message, index) => (
              <View
                key={index}
                style={[
                  styles.bubble,
                  message.role === "user"
                    ? [styles.userBubble, { backgroundColor: colors.accent }]
                    : [
                        styles.coachBubble,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ],
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    { color: message.role === "user" ? "#FFFFFF" : colors.text },
                  ]}
                >
                  {message.content}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Mic controls */}
        <View style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
          {error ? (
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          ) : null}
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>{statusLabel}</Text>

          <Pressable
            onPress={handleMicPress}
            disabled={status === "thinking"}
            style={({ pressed }) => [
              styles.micButton,
              {
                backgroundColor: micColor,
                opacity: pressed ? 0.85 : 1,
                shadowColor: micColor,
              },
            ]}
          >
            {status === "thinking" ? (
              <ActivityIndicator size="large" color="#FFFFFF" />
            ) : (
              <Ionicons
                name={
                  status === "recording"
                    ? "arrow-up"
                    : status === "idle"
                      ? "mic-off"
                      : "mic"
                }
                size={38}
                color="#FFFFFF"
              />
            )}
          </Pressable>
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
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    padding: 20,
    paddingBottom: 16,
    gap: 10,
  },
  emptyState: {
    alignItems: "center",
    marginTop: 80,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 21,
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 6,
  },
  coachBubble: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  controls: {
    alignItems: "center",
    paddingTop: 8,
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 6,
    textAlign: "center",
  },
  statusText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
  },
  micButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 10,
  },
});
