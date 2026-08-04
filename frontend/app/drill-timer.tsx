import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { useTimerAudioCues } from "@/hooks/useTimerAudioCues";
import { parseDrillDescription } from "@/lib/drillDescription";
import { completeTimedExerciseSet } from "@/lib/timedSetCompletion";
import { ArrowLeftIcon, ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from "phosphor-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function DrillTimerScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    name?: string;
    instructions?: string;
    durationSeconds?: string;
    setNumber?: string;
    exerciseId?: string;
    dayId?: string;
  }>();
  const durationSeconds = Math.max(1, Number(params.durationSeconds) || 60);
  const drillName = params.name ?? "Drill timer";
  const instructions = params.instructions ?? "";
  const setNumber = params.setNumber ? Number(params.setNumber) : null;
  const exerciseId = params.exerciseId ?? null;
  const dayId = params.dayId ?? null;
  const parsed = useMemo(() => parseDrillDescription(instructions), [instructions]);
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [running, setRunning] = useState(false);
  const runIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedRemainingRef = useRef(durationSeconds);
  const timerAudio = useTimerAudioCues();
  const completionSavedRef = useRef(false);

  const completeSet = useCallback(async () => {
    if (!exerciseId || !dayId || !setNumber || completionSavedRef.current) return;
    completionSavedRef.current = true;
    try {
      await completeTimedExerciseSet(
        dayId,
        exerciseId,
        setNumber,
        durationSeconds
      );
    } catch (error) {
      completionSavedRef.current = false;
      console.error("Failed to complete timed set:", error);
    }
  }, [dayId, durationSeconds, exerciseId, setNumber]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    timerAudio.stopAll();
    setRunning(false);
    pausedRemainingRef.current = durationSeconds;
    setRemainingSeconds(durationSeconds);
  }, [durationSeconds, timerAudio]);

  const start = useCallback(() => {
    if (pausedRemainingRef.current === durationSeconds || pausedRemainingRef.current === 0) {
      runIdRef.current += 1;
      pausedRemainingRef.current = durationSeconds;
      setRemainingSeconds(durationSeconds);
      timerAudio.beginRun(runIdRef.current, durationSeconds);
    }
    startedAtRef.current = Date.now();
    setRunning(true);
  }, [durationSeconds, timerAudio]);

  const pause = useCallback(() => {
    if (!running) return;
    pausedRemainingRef.current = remainingSeconds;
    timerAudio.pause();
    setRunning(false);
  }, [remainingSeconds, running, timerAudio]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const nextRemaining = Math.max(0, pausedRemainingRef.current - elapsed);
      timerAudio.sync(runIdRef.current, durationSeconds, nextRemaining, true);
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0) {
        pausedRemainingRef.current = 0;
        setRunning(false);
        void completeSet();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [completeSet, durationSeconds, running, timerAudio]);

  const hasStarted = remainingSeconds < durationSeconds;
  const primaryLabel = running ? "Pause" : remainingSeconds === 0 ? "Start Again" : hasStarted ? "Resume" : "Start";

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backButton}>
          <ArrowLeftIcon size={24} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Timer</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.drillName, { color: colors.text }]}>{drillName}</Text>
        {setNumber ? (
          <Text style={[styles.setLabel, { color: colors.accent }]}>Set {setNumber}</Text>
        ) : null}

        <View style={[styles.timerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.time, { color: colors.text }]}>{formatTimer(remainingSeconds)}</Text>
          <Text style={[styles.timerHint, { color: colors.textSecondary }]}>
            {running ? "Timer running" : remainingSeconds === 0 ? "Time is up" : "Ready when you are"}
          </Text>

          <View style={styles.controls}>
            <Pressable
              onPress={running ? pause : start}
              style={[styles.primaryControl, { backgroundColor: colors.accent }]}
            >
              {running ? <PauseIcon size={22} color="#FFFFFF" weight="fill" /> : <PlayIcon size={22} color="#FFFFFF" weight="fill" />}
              <Text style={styles.primaryControlText}>{primaryLabel}</Text>
            </Pressable>
            <Pressable
              onPress={reset}
              style={[styles.secondaryControl, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
            >
              <ArrowCounterClockwiseIcon size={20} color={colors.text} weight="bold" />
              <Text style={[styles.secondaryControlText, { color: colors.text }]}>Reset</Text>
            </Pressable>
          </View>
        </View>

        {parsed.intro ? <Text style={[styles.intro, { color: colors.textSecondary }]}>{parsed.intro}</Text> : null}
        {parsed.steps.length ? (
          <View style={styles.steps}>
            <Text style={[styles.stepsTitle, { color: colors.text }]}>Steps</Text>
            {parsed.steps.map((step) => (
              <View key={step.number} style={styles.stepRow}>
                <View style={[styles.stepNumber, { backgroundColor: colors.accentMuted }]}>
                  <Text style={[styles.stepNumberText, { color: colors.accent }]}>{step.number}</Text>
                </View>
                <Text style={[styles.stepText, { color: colors.text }]}>{step.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, minHeight: 44 },
  backButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "800", textAlign: "center" },
  headerSpacer: { width: 44 },
  content: { padding: 20, paddingBottom: 48 },
  drillName: { fontSize: 26, lineHeight: 32, fontWeight: "800", textAlign: "center" },
  setLabel: { marginTop: 6, fontSize: 14, fontWeight: "700", textAlign: "center" },
  timerCard: { marginTop: 24, borderWidth: 1, borderRadius: 28, padding: 28, alignItems: "center" },
  time: { fontSize: 64, lineHeight: 72, fontWeight: "800", fontVariant: ["tabular-nums"] },
  timerHint: { marginTop: 6, fontSize: 14, fontWeight: "600" },
  controls: { flexDirection: "row", width: "100%", gap: 10, marginTop: 28 },
  primaryControl: { flex: 1, minHeight: 54, borderRadius: 18, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  primaryControlText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryControl: { minHeight: 54, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  secondaryControlText: { fontSize: 15, fontWeight: "700" },
  intro: { marginTop: 26, fontSize: 15, lineHeight: 22, textAlign: "center" },
  steps: { marginTop: 28, gap: 14 },
  stepsTitle: { fontSize: 18, fontWeight: "800" },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 14, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 15, lineHeight: 22 },
});
