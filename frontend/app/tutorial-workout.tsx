import { TutorialCoachModal } from "@/components/TutorialCoachModal";
import { BottomTabShell } from "@/components/BottomTabShell";
import { DaySelector } from "@/components/DaySelector";
import { WorkoutDayDetail } from "@/components/WorkoutDayDetail";
import { WorkoutDayOverview } from "@/components/WorkoutDayOverview";
import type { TutorialAudioStep } from "@/assets/sounds/CoachTutorial/manifest";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { getCoachProfile } from "@/lib/coachProfiles";
import { completeCoachTutorial } from "@/lib/coachTutorial";
import type { ExerciseLogInput } from "@/lib/plan";
import type { WorkoutDayWithExercises } from "@/types/plan";
import { router } from "expo-router";
import { useTour, useTourTarget } from "guideway";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

type TutorialStep =
  | "welcome"
  | "start"
  | "exercises"
  | "coach"
  | "introCoach"
  | "greeting"
  | "explain"
  | "missOne"
  | "missTwo"
  | "make"
  | "timerOffer"
  | "timerRunning"
  | "close"
  | "finished";

const VOICE_STEPS: Record<Extract<TutorialStep, "greeting" | "explain" | "missOne" | "missTwo" | "make" | "timerOffer">, {
  coach: string;
  prompt: string;
  audioStep?: TutorialAudioStep;
  listeningDelayMs?: number;
}> = {
  greeting: {
    coach: "Hello. Are you ready to start your workout?",
    prompt: "Pick your answer.",
    audioStep: 3,
    listeningDelayMs: 2_500,
  },
  explain: {
    coach: "Your first exercise is Form Shooting. Your target is 2 makes out of 3 attempts.",
    prompt: "Choose how the next shot goes.",
    audioStep: 4,
    listeningDelayMs: 4_000,
  },
  missOne: {
    coach: "You’re 0 for 1. Two shots left.",
    prompt: "Decide how the next shot goes.",
    audioStep: 5,
    listeningDelayMs: 4_500,
  },
  missTwo: {
    coach: "You’re 0 for 2. One shot left.",
    prompt: "Choose how the final shot goes.",
  },
  make: {
    coach: "You’re 1 for 3. One make short of the tutorial target.",
    prompt: "Choose the final shot result.",
  },
  timerOffer: {
    coach: "Good job — you hit your target and shot 66% for Form Shooting. Now you're on Pound Dribbles. Would you like me to start the one-minute timer?",
    prompt: "Choose your answer.",
    audioStep: 6,
    listeningDelayMs: 7_000,
  },
};

const TUTORIAL_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function TypedWelcomeMessage({ color, onComplete }: { color: string; onComplete: () => void }) {
  const message = "This is a tutorial on how to use Court Coach.";
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
  }, [onComplete]);

  return <Text style={[styles.welcomeBubbleText, { color }]}>{typedMessage}</Text>;
}

const TUTORIAL_WORKOUT: WorkoutDayWithExercises = {
  id: "tutorial-workout",
  plan_id: "tutorial-plan",
  user_id: "tutorial-user",
  day_number: 1,
  block_index: 1,
  title: "Court Coach tutorial",
  focus: "Learn Court Coach",
  estimated_minutes: 2,
  coach_notes: null,
  locked: false,
  completed: false,
  completion_kind: null,
  last_activity_at: null,
  finalized_at: null,
  scheduled_date: null,
  created_at: TUTORIAL_TIMESTAMP,
  exercises: [
    {
      id: "tutorial-form-shooting",
      day_id: "tutorial-workout",
      user_id: "tutorial-user",
      video_clip_id: null,
      order_index: 0,
      name: "Form Shooting",
      category: "shooting",
      instructions: "Stay balanced, keep your elbow under the ball, and hold your follow-through.",
      sets: "1",
      reps: "3 attempts",
      duration: null,
      target_makes: 2,
      target_attempts: 3,
      log_type: "makes_attempts",
      set_side_labels: null,
      created_at: TUTORIAL_TIMESTAMP,
      video_clip: null,
      log: null,
    },
    {
      id: "tutorial-pound-dribbles",
      day_id: "tutorial-workout",
      user_id: "tutorial-user",
      video_clip_id: null,
      order_index: 1,
      name: "Pound Dribbles",
      category: "ball_handling",
      instructions: "Keep your chest up and pound the ball hard at your side.",
      sets: "1",
      reps: null,
      duration: "1 minute",
      target_makes: null,
      target_attempts: null,
      log_type: "minutes",
      set_side_labels: null,
      created_at: TUTORIAL_TIMESTAMP,
      video_clip: null,
      log: null,
    },
  ],
};

export default function TutorialWorkoutScreen() {
  const { colors } = useTheme();
  const { profile, user } = useAuth();
  const coach = getCoachProfile(profile?.realtime_coach_voice);
  const { start, stop } = useTour();
  const startWorkoutTarget = useTourTarget("tutorial-start-workout");
  const drillsTarget = useTourTarget("tutorial-drills");
  const coachTarget = useTourTarget("tutorial-coach");
  const finishWorkoutTarget = useTourTarget("tutorial-finish-workout");
  const [step, setStep] = useState<TutorialStep>("welcome");
  const startedTourRef = useRef(false);
  const closeTourStartedRef = useRef(false);
  const tourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spotlightPending, setSpotlightPending] = useState(true);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [welcomeMessageComplete, setWelcomeMessageComplete] = useState(false);
  const handleWelcomeMessageComplete = useCallback(() => setWelcomeMessageComplete(true), []);
  const [localLogs, setLocalLogs] = useState<Record<string, ExerciseLogInput>>({});
  const [completionAnimationTokens, setCompletionAnimationTokens] = useState<Record<string, number>>({});

  const coachOpen = ["introCoach", "greeting", "explain", "missOne", "missTwo", "make", "timerOffer"].includes(step);
  const showTourStep = useCallback(
    (stepIndex: number, delayMs = 1_000) => {
      if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
      setSpotlightPending(true);
      stop();
      tourTimerRef.current = setTimeout(() => {
        setSpotlightPending(false);
        start("coach-tutorial", { fromIndex: stepIndex });
        tourTimerRef.current = null;
      }, delayMs);
    },
    [start, stop]
  );

  useEffect(() => {
    if (startedTourRef.current) return;
    startedTourRef.current = true;
    tourTimerRef.current = setTimeout(() => {
      setSpotlightPending(false);
      setWelcomeMessageComplete(false);
      setWelcomeVisible(true);
      tourTimerRef.current = null;
    }, 1_000);
    return () => {
      if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (step !== "close") {
      closeTourStartedRef.current = false;
      return;
    }
    if (closeTourStartedRef.current) return;
    closeTourStartedRef.current = true;
    showTourStep(3);
  }, [showTourStep, step]);

  useEffect(() => {
    if (step !== "timerRunning") return;
    const fastForward = setTimeout(() => {
      setStep("close");
    }, 8_000);
    return () => {
      clearTimeout(fastForward);
    };
  }, [step]);

  const finishTutorial = useCallback(async () => {
    stop();
    if (user?.id) await completeCoachTutorial(user.id);
    router.replace({ pathname: "/paywall", params: { next: "generating" } });
  }, [stop, user]);

  const advanceVoiceStep = useCallback(() => {
    setStep((current) => {
      if (current === "introCoach") return "greeting";
      if (current === "greeting") return "explain";
      if (current === "explain") return "missOne";
      if (current === "missOne") return "missTwo";
      if (current === "missTwo") return "timerOffer";
      if (current === "make") return "timerOffer";
      if (current === "timerOffer") return "timerRunning";
      return current;
    });
  }, []);
  const ignoreTutorialCoachClose = useCallback(() => undefined, []);

  const activeVoiceStep = coachOpen ? VOICE_STEPS[step as keyof typeof VOICE_STEPS] : null;
  const exercisesVisible = step !== "welcome" && step !== "start";
  const complete = step === "close" || step === "finished";
  const formShootingComplete = step === "timerRunning" || complete;
  const tutorialWorkout = useMemo<WorkoutDayWithExercises>(() => {
    const exerciseLog = (exerciseId: string, defaults: Omit<ExerciseLogInput, "exercise_id">) => {
      const local = localLogs[exerciseId];
      if (!local && !defaults.completed) return null;
      const log = local ?? { exercise_id: exerciseId, ...defaults };
      return {
        id: `local-${exerciseId}`,
        exercise_id: exerciseId,
        day_id: TUTORIAL_WORKOUT.id,
        user_id: TUTORIAL_WORKOUT.user_id,
        completed: log.completed,
        makes: log.makes ?? null,
        attempts: log.attempts ?? null,
        minutes_completed: log.minutes_completed ?? null,
        difficulty: log.difficulty ?? null,
        notes: log.notes ?? null,
        created_at: TUTORIAL_TIMESTAMP,
        updated_at: TUTORIAL_TIMESTAMP,
      };
    };

    return {
      ...TUTORIAL_WORKOUT,
      completed: complete,
      completion_kind: complete ? "full" : null,
      exercises: TUTORIAL_WORKOUT.exercises.map((exercise) => ({
        ...exercise,
        log:
          exercise.id === "tutorial-form-shooting"
            ? exerciseLog(exercise.id, {
                completed: formShootingComplete,
                makes: formShootingComplete ? 2 : null,
                attempts: formShootingComplete ? 3 : null,
                minutes_completed: null,
                difficulty: null,
                notes: null,
              })
            : exerciseLog(exercise.id, {
                completed: complete,
                makes: null,
                attempts: null,
                minutes_completed: complete ? 1 : null,
                difficulty: null,
                notes: null,
              }),
      })),
    };
  }, [complete, formShootingComplete, localLogs]);
  const shootingStats = useMemo(
    () => ({
      shots: formShootingComplete ? 3 : 0,
      makes: formShootingComplete ? 2 : 0,
      accuracy: formShootingComplete ? 67 : null,
    }),
    [formShootingComplete]
  );

  const handleLocalLogChange = useCallback((log: ExerciseLogInput) => {
    setLocalLogs((logs) => ({ ...logs, [log.exercise_id]: log }));
    if (log.completed) {
      setCompletionAnimationTokens((tokens) => ({ ...tokens, [log.exercise_id]: Date.now() }));
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.selectorHeader}>
        <DaySelector
          days={[TUTORIAL_WORKOUT]}
          selectedDayNumber={1}
          currentDayNumber={1}
          onSelect={() => undefined}
        />
        <Pressable
          ref={finishWorkoutTarget}
          onPress={() => {
            if (step === "close") {
              stop();
              setStep("finished");
            }
          }}
          style={[styles.close, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.closeText, { color: colors.text }]}>×</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} scrollEnabled={step === "finished"}>
        {!exercisesVisible ? (
          <WorkoutDayOverview
            startWorkoutTargetRef={startWorkoutTarget}
            model={{
              dayNumber: 1,
              isPastOrCompleted: false,
              completed: false,
              exerciseStats: { completed: 0, total: TUTORIAL_WORKOUT.exercises.length, progress: 0 },
              performance: { score: 0, hasData: false },
              weeklyStats: { shots: 0, accuracy: null, averagePerformance: null },
            }}
            actions={{
              onStartWorkout: () => {
                setStep("exercises");
                showTourStep(1);
              },
              onViewWorkoutStats: () => undefined,
            }}
          />
        ) : (
          <View>
            <WorkoutDayDetail
              drillsTargetRef={drillsTarget}
              model={{
                workout: tutorialWorkout,
                shootingStats,
                editing: false,
                finishing: false,
                completionAnimationTokens,
                exerciseOrder: "provided",
              }}
              actions={{
                onBack: () => undefined,
                onToggleEditing: () => undefined,
                onAddWithAI: () => undefined,
                onAddManually: () => undefined,
                onDeleteExercise: () => undefined,
                onLogChange: handleLocalLogChange,
                onExercisePress: () => {
                  if (step === "exercises") {
                    setStep("coach");
                    showTourStep(2, 0);
                  }
                },
                onFinish: () => {
                  if (step === "close") {
                    stop();
                    setStep("finished");
                  }
                },
              }}
            />
            {step === "finished" ? (
              <Pressable onPress={finishTutorial} style={[styles.endButton, { backgroundColor: colors.accent }]}>
                <Text style={styles.startButtonText}>End tutorial</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>

      {welcomeVisible ? (
        <>
          <View pointerEvents="none" style={styles.welcomeDimmer} />
          <View style={[styles.welcomeBubble, { backgroundColor: colors.card }]}>
            <View style={[styles.welcomeBubbleLabel, { backgroundColor: colors.accent }]}>
              <Text style={styles.welcomeBubbleLabelText}>Court Coach</Text>
            </View>
            <TypedWelcomeMessage color={colors.text} onComplete={handleWelcomeMessageComplete} />
          </View>
        </>
      ) : null}

      {welcomeVisible && welcomeMessageComplete ? (
        <View style={styles.welcomeActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setWelcomeVisible(false);
              setStep("start");
              showTourStep(0);
            }}
            style={[styles.welcomeButton, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.welcomePrimaryText}>Start Tutorial</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void finishTutorial()}
            style={[styles.welcomeButton, styles.welcomeSecondaryButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.welcomeSecondaryText, { color: colors.text }]}>Skip tutorial</Text>
          </Pressable>
        </View>
      ) : null}

      <BottomTabShell
        locked
        coachTargetRef={coachTarget}
        onCoachPress={() => {
          if (step === "coach") {
            stop();
            setStep("introCoach");
          }
        }}
      />
      {spotlightPending ? <View pointerEvents="auto" style={styles.interactionBlocker} /> : null}

      <TutorialCoachModal
        visible={coachOpen}
        coachName={coach.name}
        persona={coach.id}
        coachMessage={activeVoiceStep?.coach ?? ""}
        tutorialPrompt={
          step === "introCoach"
            ? "In a real workout, you would use your voice to talk to me. For now, we’ll click through what would happen."
            : activeVoiceStep?.prompt ?? ""
        }
        audioStep={activeVoiceStep?.audioStep}
        listeningDelayMs={activeVoiceStep?.listeningDelayMs}
        choices={
          step === "introCoach"
            ? ['"Sounds good"']
            : step === "greeting"
              ? ['"Definitely, Coach"', '"Never been more ready"']
              : step === "timerOffer"
                ? ['"Yes"']
            : step === "explain"
              ? ['"Miss"', '"Make"']
              : step === "missOne" || step === "missTwo"
                ? ['"Miss"', '"Make"']
                : ['"Yes"']
        }
        onChoice={advanceVoiceStep}
        onClose={ignoreTutorialCoachClose}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  selectorHeader: { position: "relative" },
  close: { position: "absolute", top: 10, right: 16, width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 30 },
  closeText: { fontSize: 27, lineHeight: 30 },
  content: { padding: 20, paddingBottom: 126 },
  interactionBlocker: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 70 },
  welcomeDimmer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.84)", zIndex: 50 },
  welcomeBubble: {
    position: "absolute",
    top: 84,
    left: 40,
    right: 40,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 16,
    borderRadius: 22,
    zIndex: 60,
  },
  welcomeBubbleLabel: { position: "absolute", top: -12, left: 12, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12 },
  welcomeBubbleLabelText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  welcomeBubbleText: { fontSize: 16, fontWeight: "700", lineHeight: 24, textAlign: "center" },
  welcomeActions: {
    position: "absolute",
    top: 184,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    zIndex: 60,
  },
  welcomeButton: { minWidth: 148, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, alignItems: "center" },
  welcomeSecondaryButton: { borderWidth: 1 },
  welcomePrimaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  welcomeSecondaryText: { fontSize: 16, fontWeight: "800" },
  startButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  endButton: { marginTop: 18, paddingVertical: 15, borderRadius: 16, alignItems: "center" },
});
