import { Text } from "@/components/Text";
import type { TutorialAudioStep } from "@/assets/sounds/CoachTutorial/manifest";
import { useTutorialCoachAudio } from "@/hooks/useTutorialCoachAudio";
import { useTheme } from "@/hooks/useTheme";
import type { CoachPersonaId } from "@/lib/coachProfiles";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Animated, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface TutorialCoachModalProps {
  visible: boolean;
  coachName: string;
  persona: CoachPersonaId;
  coachMessage: string;
  tutorialPrompt: string;
  audioStep?: TutorialAudioStep;
  listeningDelayMs?: number;
  choices: string[];
  onChoice: () => void;
  onClose: () => void;
}

function TypedVoicePrompt({
  message,
  color,
  onProgress,
  onComplete,
}: {
  message: string;
  color: string;
  onProgress?: (characterCount: number) => void;
  onComplete: () => void;
}) {
  const [typedMessage, setTypedMessage] = useState("");

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedMessage(message.slice(0, index));
      onProgress?.(index);
      if (index >= message.length) {
        clearInterval(interval);
        onComplete();
      }
    }, 16);
    return () => clearInterval(interval);
  }, [message, onComplete, onProgress]);

  return <Text style={[styles.voicePromptText, { color }]}>{typedMessage}</Text>;
}

function TypedCoachTranscript({
  message,
  color,
  onComplete,
}: {
  message: string;
  color: string;
  onComplete: () => void;
}) {
  const [typedMessage, setTypedMessage] = useState("");

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedMessage(message.slice(0, index));
      if (index >= message.length) {
        clearInterval(interval);
        onComplete();
      }
    }, 16);
    return () => clearInterval(interval);
  }, [message, onComplete]);

  return <Text style={[styles.transcript, { color }]}>{typedMessage}</Text>;
}

export function TutorialCoachModal({
  visible,
  coachName,
  persona,
  coachMessage,
  tutorialPrompt,
  audioStep,
  listeningDelayMs = 0,
  choices,
  onChoice,
  onClose,
}: TutorialCoachModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { play, stop: stopCoachAudio } = useTutorialCoachAudio();
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [choicePhase, setChoicePhase] = useState<"idle" | "thinking" | "speaking">("idle");
  const [promptCharacterCount, setPromptCharacterCount] = useState(0);
  const [thinkingDotOffsets] = useState(() =>
    Array.from({ length: 3 }, () => new Animated.Value(0))
  );
  const handlePromptTyped = useCallback(() => setChoicesVisible(true), []);
  useEffect(() => {
    let choiceTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setChoicesVisible(false);
      setPromptVisible(false);
      setPromptCharacterCount(0);
      if (visible && audioStep) play(persona, audioStep);
      choiceTimer = setTimeout(() => setPromptVisible(visible), listeningDelayMs);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (choiceTimer) clearTimeout(choiceTimer);
      stopCoachAudio();
    };
  }, [audioStep, coachMessage, listeningDelayMs, persona, play, stopCoachAudio, visible]);

  useEffect(() => {
    if (choicePhase === "thinking") {
      const timer = setTimeout(() => {
        setChoicePhase("speaking");
        onChoice();
      }, 1_000);
      return () => clearTimeout(timer);
    }
  }, [choicePhase, onChoice]);

  useEffect(() => {
    if (choicePhase !== "thinking") {
      thinkingDotOffsets.forEach((offset) => offset.setValue(0));
      return;
    }
    const animation = Animated.loop(
      Animated.stagger(
        150,
        thinkingDotOffsets.map((offset) =>
          Animated.sequence([
            Animated.timing(offset, { toValue: -8, duration: 180, useNativeDriver: true }),
            Animated.timing(offset, { toValue: 0, duration: 180, useNativeDriver: true }),
          ])
        )
      )
    );
    animation.start();
    return () => animation.stop();
  }, [choicePhase, thinkingDotOffsets]);

  const stackChoices = choices.some((choice) => choice.length > 12);
  const statusLabel =
    choicePhase === "thinking" ? "Thinking" : promptVisible ? "Listening" : "Coach is talking";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>{coachName}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Tutorial workout</Text>
          </View>
          <View style={[styles.timerChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="play" size={14} color={colors.accent} style={styles.timerIcon} />
            <Text style={[styles.timerText, { color: colors.text }]}>0:00</Text>
          </View>
          <Pressable
            accessibilityLabel="Close Coach"
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>
        {promptVisible ? <View pointerEvents="none" style={styles.fullScreenDimmer} /> : null}
        <View style={styles.center}>
          <View style={styles.transcripts}>
            {userTranscript ? (
              <Text style={[styles.transcript, { color: colors.textSecondary }]}>{userTranscript}</Text>
            ) : null}
            {choicePhase === "speaking" ? (
              <TypedCoachTranscript
                key={coachMessage}
                message={coachMessage}
                color={colors.text}
                onComplete={() => setChoicePhase("idle")}
              />
            ) : (
              <Text style={[styles.transcript, { color: colors.text }]}>{coachMessage}</Text>
            )}
          </View>
          {promptVisible ? (
            <View style={styles.promptStack}>
              <View style={[styles.voicePrompt, { backgroundColor: colors.card }]}>
              <View style={[styles.voicePromptLabel, { backgroundColor: colors.accent }]}>
                {promptCharacterCount >= 8 ? (
                  <Text style={styles.voicePromptLabelText}>Court Coach</Text>
                ) : null}
              </View>
                <TypedVoicePrompt
                  key={tutorialPrompt}
                  message={tutorialPrompt}
                  color={colors.text}
                  onProgress={setPromptCharacterCount}
                  onComplete={handlePromptTyped}
                />
              </View>
              {choicesVisible ? (
                <View style={[styles.choiceRow, stackChoices && styles.choiceRowStack]}>
                  {choices.map((choice) => (
                    <Pressable
                      key={choice}
                      onPress={() => {
                        setChoicesVisible(false);
                        setPromptVisible(false);
                        setUserTranscript(choice.replace(/^"|"$/g, ""));
                        setChoicePhase("thinking");
                      }}
                      style={({ pressed }) => [
                        styles.choiceButton,
                        { backgroundColor: colors.card, borderColor: colors.accent, opacity: pressed ? 0.75 : 1 },
                      ]}
                    >
                      <Text style={[styles.choiceText, { color: colors.text }]}>{choice}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.coachControls}>
            <Text style={[styles.statusLabel, { color: colors.text }]}>{statusLabel}</Text>
          </View>
          <View style={[styles.orbSpotlight, { backgroundColor: colors.background }]} />
          <View style={[styles.orb, { backgroundColor: colors.accent, shadowColor: colors.accent }]}>
            {choicePhase === "thinking" ? (
              <View style={styles.thinkingDots} accessibilityLabel="Coach is thinking">
                {thinkingDotOffsets.map((offset, index) => (
                  <Animated.View
                    key={index}
                    style={[styles.thinkingDot, { transform: [{ translateY: offset }] }]}
                  />
                ))}
              </View>
            ) : promptVisible ? (
              <Ionicons name="mic" size={52} color="#FFFFFF" />
            ) : (
              <Image
                source={require("../assets/images/WhiteAppLogoForButton.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontWeight: "800" },
  subtitle: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  timerChip: { flexDirection: "row", alignItems: "center", borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  timerIcon: { marginRight: 6 },
  timerText: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  close: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", position: "relative", zIndex: 2 },
  transcripts: { position: "absolute", top: 24, left: 24, right: 24, gap: 10 },
  transcript: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  orb: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -75,
    marginLeft: -75,
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 14,
    zIndex: 2,
  },
  logo: { width: 78, height: 78 },
  orbSpotlight: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 170,
    height: 170,
    borderRadius: 85,
    marginTop: -85,
    marginLeft: -85,
    zIndex: 1,
  },
  coachControls: { position: "absolute", top: "50%", marginTop: -134, alignItems: "center", zIndex: 1 },
  statusLabel: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  thinkingDots: { flexDirection: "row", alignItems: "center", gap: 8 },
  thinkingDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" },
  fullScreenDimmer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(12,12,14,0.62)",
    zIndex: 1,
  },
  promptStack: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    bottom: "50%",
    marginBottom: 96,
    zIndex: 2,
  },
  voicePrompt: {
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 16,
    borderRadius: 22,
    zIndex: 2,
    alignSelf: "center",
    maxWidth: 320,
  },
  voicePromptLabel: {
    position: "absolute",
    top: -12,
    left: 12,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  voicePromptLabelText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  voicePromptText: { fontSize: 16, lineHeight: 24, fontWeight: "700", textAlign: "center" },
  choiceRow: { alignSelf: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 16 },
  choiceRowStack: { flexDirection: "column", alignItems: "center" },
  choiceButton: { alignSelf: "center", borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  choiceText: { fontSize: 14, fontWeight: "800" },
});
