import { OnboardingStep } from "@/components/OnboardingStep";
import { SkillSlider } from "@/components/SkillSlider";
import { AIDataProcessingDisclosure } from "@/components/AIDataProcessingDisclosure";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { useCoachIntroAudio } from "@/hooks/useCoachIntroAudio";
import { useTheme } from "@/hooks/useTheme";
import { selectionHaptic } from "@/lib/haptics";
import {
  clearPendingAIDataConsent,
  savePendingAIDataConsent,
  setAIDataConsent,
} from "@/lib/aiDataConsent";
import {
  COACH_PROFILES,
  DEFAULT_COACH_VOICE,
  CoachVoice,
} from "@/lib/coachProfiles";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { markCoachTutorialPending } from "@/lib/coachTutorial";
import { supabase } from "@/lib/supabase";
import { OnboardingFormData } from "@/types/plan";
import { Text } from "@/components/Text";
import { TextInput } from "@/components/TextInput";
import { router } from "expo-router";
import { LineChart } from "react-native-gifted-charts";
import {
  BasketballIcon,
  BarbellIcon,
  AlarmIcon,
  ArrowsOutIcon,
  ArrowsOutLineHorizontalIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  CrownIcon,
  FootprintsIcon,
  HandIcon,
  HeartIcon,
  HourglassLowIcon,
  LightningIcon,
  MedalIcon,
  PersonSimpleRunIcon,
  PersonSimpleWalkIcon,
  QuestionIcon,
  ShieldIcon,
  StarIcon,
  TargetIcon,
  TimerIcon,
  TrendUpIcon,
  TrophyIcon,
  UserCircleIcon,
  WatchIcon,
  XCircleIcon,
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite"];
const GOALS = [
  "Improve shooting",
  "Improve handles",
  "Improve finishing",
  "Improve defense",
  "Get faster",
  "Improve conditioning",
  "Become stronger",
  "Become a more complete player",
];
const PLAYING_LEVELS = [
  "Elementary School",
  "Middle School",
  "JV High School",
  "Varsity High School",
  "College",
  "Professional",
  "No team / just for fun",
];
const PLAYING_FOR_FUN = "No team / just for fun";
const POSITIONS = ["Guard", "Wing", "Big", "Unknown"];
const WEAKNESS_OPTIONS = [
  "Shooting",
  "Ball handling",
  "Finishing",
  "Defense",
  "Footwork",
  "Conditioning",
  "Strength",
];
const STRENGTH_OPTIONS = [
  "Shooting",
  "Ball handling",
  "Finishing",
  "Defense",
  "Footwork",
  "Conditioning",
  "Strength",
];
const INTENSITY_OPTIONS = ["Light", "Medium", "Hard", "Extremely hard"];
const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const MINUTES_OPTIONS = [15, 30, 45, 60, 75, 90];

const QUESTION_STEPS = 13;
const PRE_SIGNUP_STEP = 14;
const COACH_INTRO_STEP = 15;
const COACH_SELECTION_STEP = 16;
const PROGRESS_POTENTIAL_STEP = 17;
const WHY_COURT_COACH_STEP = 18;
const AI_CONSENT_STEP = 19;
const PRE_SIGNUP_TOTAL_STEPS = AI_CONSENT_STEP;
const GENERATION_STEPS = [
  "Calculating your workout length",
  "Reading your goals and skill levels",
  "Finding exercises tailored to you",
  "Balancing drill categories and difficulty",
  "Scheduling your first five workouts",
];
const CHECKLIST_STEP_MS = 1_000;
const DISALLOWED_NAME_PATTERNS = [
  /\b(?:fuck|shit|bitch|asshole|dick|cunt|bastard)\b/i,
  /\b(?:nigger|faggot|kike|spic|chink)\b/i,
];

function validatePreferredName(value: string): string | null {
  const name = value.trim();
  if (!/^[\p{L}][\p{L} '-]{0,79}$/u.test(name)) {
    return "Use 1 to 80 letters, spaces, apostrophes, or hyphens.";
  }
  return DISALLOWED_NAME_PATTERNS.some((pattern) => pattern.test(name))
    ? "Please choose a different name."
    : null;
}

const initialForm: OnboardingFormData = {
  overall_skill_level: "",
  playing_level: "",
  main_goal: "",
  position: "",
  strengths: "",
  weaknesses: "",
  shooting_level: "5",
  ball_handling_level: "5",
  finishing_level: "5",
  defense_level: "5",
  basketball_iq_level: "5",
  conditioning_level: "5",
  athleticism_level: "5",
  strength_level: "5",
  days_per_week: 0,
  minutes_per_workout: 0,
  has_court_access: true,
  equipment: ["Basketball"],
  injuries_limitations: "",
  preferred_intensity: "",
};

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const { playNext: playCoachIntroduction, stop: stopCoachIntroduction } = useCoachIntroAudio();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingFormData>(initialForm);
  const [playingLevel, setPlayingLevel] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [coachVoice, setCoachVoice] = useState<CoachVoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedChecklistSteps, setCompletedChecklistSteps] = useState(0);
  const [checklistRun, setChecklistRun] = useState(0);
  const totalSteps = user ? QUESTION_STEPS + 1 : PRE_SIGNUP_TOTAL_STEPS;
  const visibleStep = user && step === AI_CONSENT_STEP ? QUESTION_STEPS + 1 : step;
  const selectedCoachVoice = coachVoice ?? DEFAULT_COACH_VOICE;
  const selectedCoach = COACH_PROFILES.find((coach) => coach.voice === selectedCoachVoice)!;

  useEffect(() => {
    if (step !== COACH_SELECTION_STEP) stopCoachIntroduction();
  }, [step, stopCoachIntroduction]);

  // Already finished onboarding — don't make them answer again.
  useEffect(() => {
    if (!authLoading && profile?.onboarding_completed && !submitting) {
      router.replace("/");
    }
  }, [authLoading, profile, submitting]);

  // If someone lands back here (e.g. tapped "Back" from the signup screen,
  // or resumed the app before creating an account), restore anything they'd
  // already filled in rather than starting the questionnaire over.
  useEffect(() => {
    if (user) return;
    loadOnboardingDraft().then((draft) => {
      if (draft) {
        setForm({ ...draft, has_court_access: true, equipment: ["Basketball"] });
        setPlayingLevel(draft.playing_level ?? "");
        setCoachVoice(draft.realtime_coach_voice ?? null);
      }
    });
  }, [user]);

  useEffect(() => {
    if (step !== PRE_SIGNUP_STEP) return;
    const timeouts = GENERATION_STEPS.map((_, index) =>
      setTimeout(() => setCompletedChecklistSteps(index + 1), (index + 1) * CHECKLIST_STEP_MS)
    );
    return () => timeouts.forEach(clearTimeout);
  }, [checklistRun, step]);

  const update = <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleTextSelection = (field: "main_goal" | "strengths" | "weaknesses", option: string) => {
    setForm((prev) => {
      const selected = prev[field]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const next = selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option];
      return { ...prev, [field]: next.join(", ") };
    });
  };

  const selectedTextValues = (value: string) =>
    value.split(",").map((item) => item.trim()).filter(Boolean);
  const currentDraft = () => ({
    ...form,
    preferred_name: preferredName.trim(),
    ...(coachVoice ? { realtime_coach_voice: coachVoice } : {}),
  });

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
      case 2:
        return true;
      case 3:
        return preferredName.trim().length > 0 && !nameError;
      case 4:
        return !!form.overall_skill_level;
      case 5:
        return !!playingLevel;
      case 6:
        return !!form.main_goal;
      case 7:
        return !!form.position;
      case 8:
        return selectedTextValues(form.strengths).length > 0;
      case 9:
        return selectedTextValues(form.weaknesses).length > 0;
      case 10:
        return true;
      case 11:
        return form.days_per_week > 0;
      case 12:
        return form.minutes_per_workout > 0;
      case 13:
        return !!form.preferred_intensity;
      case PRE_SIGNUP_STEP:
        return completedChecklistSteps === GENERATION_STEPS.length;
      case COACH_SELECTION_STEP:
        return coachVoice !== null;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (step === 3) {
      const validationError = validatePreferredName(preferredName);
      setNameError(validationError);
      if (validationError) return;
    }
    if (step < QUESTION_STEPS) {
      if (!user) await saveOnboardingDraft(currentDraft());
      setStep(step + 1);
      return;
    }
    if (step === QUESTION_STEPS && user) {
      setStep(AI_CONSENT_STEP);
      return;
    }
    if (step === QUESTION_STEPS && !user) {
      await saveOnboardingDraft(currentDraft());
      setCompletedChecklistSteps(0);
      setChecklistRun((run) => run + 1);
      setStep(PRE_SIGNUP_STEP);
      return;
    }
    if (step === PRE_SIGNUP_STEP && !user) {
      setStep(COACH_INTRO_STEP);
      return;
    }
    if (step === COACH_INTRO_STEP && !user) {
      setStep(COACH_SELECTION_STEP);
      return;
    }
    if (step === COACH_SELECTION_STEP && !user) {
      await saveOnboardingDraft(currentDraft());
      setStep(PROGRESS_POTENTIAL_STEP);
      return;
    }
    if (step === PROGRESS_POTENTIAL_STEP && !user) {
      setStep(WHY_COURT_COACH_STEP);
      return;
    }
    if (step === WHY_COURT_COACH_STEP && !user) {
      setStep(AI_CONSENT_STEP);
      return;
    }
    if (step === AI_CONSENT_STEP) {
      await handleSubmit(true);
    }
  };

  const handleSubmit = async (aiConsentAllowed: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      await savePendingAIDataConsent(aiConsentAllowed);
      if (user) {
        await setAIDataConsent(aiConsentAllowed, "onboarding");
      }
      if (user) {
        // Existing authenticated accounts can complete onboarding here.
        // Start their real plan behind the paywall so it can be ready after purchase.
        await Promise.all([
          submitOnboardingAnswers(user.id, form),
          supabase
            .from("profiles")
            .update({
              realtime_coach_voice: coachVoice ?? DEFAULT_COACH_VOICE,
              preferred_name: preferredName.trim() || null,
            })
            .eq("id", user.id)
            .then(({ error: profileError }) => {
              if (profileError) throw profileError;
            }),
        ]);
        await Promise.all([
          clearOnboardingDraft(),
          clearPendingAIDataConsent(),
        ]);
        await refreshProfile();
        await markCoachTutorialPending(user.id);
        router.replace("/tutorial-workout");
        void requestPlanGeneration().catch((generationError) => {
          console.error("Unable to start initial plan generation:", generationError);
        });
        return;
      }

      // Normal path: no account yet. Stash the answers locally and move on
      // to account creation -- they get written to Supabase right after
      // signup succeeds.
      await saveOnboardingDraft(currentDraft());
      router.push("/auth/signup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (step === AI_CONSENT_STEP && user) {
      setStep(QUESTION_STEPS);
      return;
    }
    if (step > 1) {
      if (step === PRE_SIGNUP_STEP || step === COACH_INTRO_STEP) {
        setCompletedChecklistSteps(0);
        setChecklistRun((run) => run + 1);
      }
      setStep(step - 1);
      return;
    }
    router.replace("/welcome");
  };

  return (
    <OnboardingStep
      title={STEP_TITLES[step - 1].title}
      subtitle={STEP_TITLES[step - 1].subtitle}
      step={visibleStep}
      totalSteps={totalSteps}
      onNext={handleNext}
      onBack={handleBack}
      nextLabel={
        step === PROGRESS_POTENTIAL_STEP
          ? "Reveal Advantage"
          : step === WHY_COURT_COACH_STEP
            ? "Start Training Smarter"
            : step === AI_CONSENT_STEP
              ? "Agree and Continue"
              : step === QUESTION_STEPS && user
                ? "Build My Plan"
                : "Continue"
      }
      nextDisabled={!canGoNext()}
      nextLoading={submitting}
    >
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {step === 1 && (
        <View style={styles.introSlide}>
          <Image
            source={require("../../assets/images/basketballplayersiloutte.png")}
            style={styles.problemImage}
            resizeMode="contain"
          />
        </View>
      )}

      {step === 2 && (
        <View style={styles.introSlide}>
          <Image
            source={require("../../assets/images/playerwithfloatingbubbles.png")}
            style={styles.problemImage}
            resizeMode="contain"
          />
        </View>
      )}

      {step === 3 && (
        <View>
          <TextInput
            value={preferredName}
            onChangeText={(value) => {
              const normalized = value.replace(/\s+/g, " ").trimStart();
              setPreferredName(normalized);
              setNameError(validatePreferredName(normalized));
            }}
            placeholder="Enter your preferred name"
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="done"
          />
          {nameError ? <Text style={[styles.error, { color: colors.danger }]}>{nameError}</Text> : null}
        </View>
      )}
      {step === 4 && (
        <ChipGroup
          options={SKILL_LEVELS.map((level) => ({
            label: capitalize(level),
            value: level,
            icon: skillLevelIcon(level),
          }))}
          selected={[form.overall_skill_level]}
          onToggle={(v) => update("overall_skill_level", v)}
        />
      )}

      {step === 5 && (
        <ChipGroup
          options={PLAYING_LEVELS.map((level) => ({
            label: level,
            value: level,
            icon: playingLevelIcon(level),
          }))}
          selected={[playingLevel]}
          onToggle={(level) => {
            setPlayingLevel(level);
            update("playing_level", level === PLAYING_FOR_FUN ? "JV High School" : level);
          }}
        />
      )}

      {step === 6 && (
        <ChipGroup
          options={GOALS.map((goal) => ({ label: goal, value: goal, icon: goalIcon(goal) }))}
          selected={selectedTextValues(form.main_goal)}
          onToggle={(value) => toggleTextSelection("main_goal", value)}
        />
      )}

      {step === 7 && (
        <ChipGroup
          options={POSITIONS.map((position) => ({
            label: position,
            value: position,
            icon: positionIcon(position),
          }))}
          selected={[form.position]}
          onToggle={(v) => update("position", v)}
        />
      )}

      {step === 8 && (
        <View>
          <ChipGroup
            options={STRENGTH_OPTIONS.map((strength) => ({
              label: strength,
              value: strength,
              icon: skillIcon(strength),
            }))}
            selected={selectedTextValues(form.strengths)}
            onToggle={(value) => toggleTextSelection("strengths", value)}
            multi
          />
        </View>
      )}

      {step === 9 && (
        <View>
          <ChipGroup
            options={WEAKNESS_OPTIONS.map((weakness) => ({
              label: weakness,
              value: weakness,
              icon: skillIcon(weakness),
            }))}
            selected={selectedTextValues(form.weaknesses)}
            onToggle={(value) => toggleTextSelection("weaknesses", value)}
            multi
          />
        </View>
      )}

      {step === 10 && (
        <View>
          <SkillSlider label="Shooting" value={form.shooting_level ? Number(form.shooting_level) : null} onChange={(v) => update("shooting_level", String(v))} />
          <SkillSlider label="Ball Handling" value={form.ball_handling_level ? Number(form.ball_handling_level) : null} onChange={(v) => update("ball_handling_level", String(v))} />
          <SkillSlider label="Finishing" value={form.finishing_level ? Number(form.finishing_level) : null} onChange={(v) => update("finishing_level", String(v))} />
          <SkillSlider label="Defense" value={form.defense_level ? Number(form.defense_level) : null} onChange={(v) => update("defense_level", String(v))} />
          <SkillSlider label="Conditioning" value={form.conditioning_level ? Number(form.conditioning_level) : null} onChange={(v) => update("conditioning_level", String(v))} />
          <SkillSlider label="Athleticism" value={form.athleticism_level ? Number(form.athleticism_level) : null} onChange={(v) => update("athleticism_level", String(v))} />
          <SkillSlider label="Strength" value={form.strength_level ? Number(form.strength_level) : null} onChange={(v) => update("strength_level", String(v))} />
        </View>
      )}

      {step === 11 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Days per week you can train</Text>
          <ChipGroup
            options={DAYS_PER_WEEK_OPTIONS.map((day) => dayOption(day))}
            selected={form.days_per_week > 0 ? [String(form.days_per_week)] : []}
            onToggle={(v) => update("days_per_week", Number(v))}
          />
        </View>
      )}

      {step === 12 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Minutes per workout</Text>
          <ChipGroup
            options={MINUTES_OPTIONS.map((minutes) => minuteOption(minutes))}
            selected={form.minutes_per_workout > 0 ? [String(form.minutes_per_workout)] : []}
            onToggle={(v) => update("minutes_per_workout", Number(v))}
          />
        </View>
      )}

      {step === 13 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Preferred workout intensity</Text>
          <ChipGroup
            options={INTENSITY_OPTIONS.map((intensity) => ({
              label: intensity,
              value: intensity,
              icon: intensityIcon(intensity),
            }))}
            selected={[form.preferred_intensity]}
            onToggle={(v) => update("preferred_intensity", v)}
          />
        </View>
      )}

      {step === PRE_SIGNUP_STEP && !user && (
        <View style={styles.checklist}>
          {GENERATION_STEPS.map((label, index) => {
            const complete = index < completedChecklistSteps;
            const active = index === completedChecklistSteps;
            return (
              <View
                key={label}
                style={[
                  styles.checklistRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {complete ? (
                  <CheckCircleIcon size={25} color="#35B96F" weight="fill" />
                ) : active ? (
                  <View style={styles.checklistIndicator}>
                    <ActivityIndicator size="small" color={colors.accent} />
                  </View>
                ) : (
                  <CircleIcon size={25} color={colors.textMuted} weight="regular" />
                )}
                <Text
                  style={[
                    styles.checklistText,
                    { color: complete || active ? colors.text : colors.textMuted },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {step === COACH_INTRO_STEP && !user && (
        <View style={styles.infoSlide}>
          <Image
            source={require("../../assets/images/AppLogo.png")}
            style={styles.appLogo}
            resizeMode="contain"
          />
          <Text style={[styles.infoLead, { color: colors.text }]}>

          </Text>
          <View style={styles.coachFeatures}>
            <CoachFeature
              icon={<TargetIcon />}
              title="Log as you train"
              description="Tell Court Coach your makes and attempts, and it saves the result for you."
            />
            <CoachFeature
              icon={<ArrowsOutIcon />}
              title="Adjust your workout"
              description="Change, add, remove, or skip drills whenever your workout needs to adapt."
            />
            <CoachFeature
              icon={<QuestionIcon />}
              title="Get instant guidance"
              description="Ask for a drill explanation, what comes next, or how much work is left."
            />
            <CoachFeature
              icon={<TimerIcon />}
              title="Keep everything moving"
              description="Start timers and mark sets or entire drills complete without losing your flow."
            />
          </View>
        </View>
      )}

      {step === COACH_SELECTION_STEP && !user && (
        <View style={styles.coachChoiceList}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play ${selectedCoach.name}'s introduction`}
            onPress={() => playCoachIntroduction(selectedCoach.id)}
            style={[styles.selectedCoachOrb, { backgroundColor: colors.accent }]}
          >
            <Image
              source={require("../../assets/images/WhiteAppLogoForButton.png")}
              style={styles.selectedCoachOrbIcon}
              resizeMode="contain"
            />
          </Pressable>
          {COACH_PROFILES.map((coach) => {
            const selected = coach.voice === selectedCoachVoice;
            return (
              <Pressable
                key={coach.voice}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  selectionHaptic();
                  setCoachVoice(coach.voice);
                  playCoachIntroduction(coach.id);
                }}
                style={({ pressed }) => [
                  styles.coachChoice,
                  {
                    backgroundColor: selected ? colors.accentMuted : colors.cardAlt,
                    borderColor: selected ? colors.accent : colors.border,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <View style={styles.coachChoiceCopy}>
                  <Text style={[styles.coachChoiceName, { color: colors.text }]}>{coach.name}</Text>
                  <Text style={[styles.coachChoiceDescription, { color: colors.textSecondary }]}>
                    {coach.description}
                  </Text>
                </View>
                <View style={styles.coachChoiceStatus}>
                  {coach.recommended ? (
                    <Text style={[styles.coachChoiceRecommended, { color: colors.accent }]}>
                      Recommended
                    </Text>
                  ) : null}
                  {selected ? <CheckCircleIcon size={24} color={colors.accent} weight="fill" /> : null}
                </View>
              </Pressable>
            );
          })}
          <Text style={[styles.coachChoiceFootnote, { color: colors.textMuted }]}>
            Tap the selected coach orb to hear an introduction. You can change your coach anytime in Settings.
          </Text>
        </View>
      )}

      {step === PROGRESS_POTENTIAL_STEP && !user && <ProgressPotentialChart />}

      {step === WHY_COURT_COACH_STEP && !user && <WhyCourtCoachComparison />}

      {step === AI_CONSENT_STEP && (
        <View style={styles.consentSlide}>
          <AIDataProcessingDisclosure />
          <Button
            title="Not Now"
            variant="outline"
            onPress={() => {
              selectionHaptic();
              void handleSubmit(false);
            }}
            disabled={submitting}
            style={styles.consentNotNow}
          />
        </View>
      )}
    </OnboardingStep>
  );
}

function ProgressPotentialChart() {
  const labels = ["START", "2w", "4w", "6w", "8w", "MAX"];
  const [chartWidth, setChartWidth] = useState(0);
  const axisGutter = 36;
  const horizontalPadding = 36;
  const plotWidth = Math.max(0, chartWidth - axisGutter - horizontalPadding);
  const edgeInset = 16;
  const spacing = plotWidth > 0 ? Math.max(0, (plotWidth - edgeInset * 2) / 5) : 42;
  const coachData = [0, 12, 31, 54, 72, 90].map((value, index, values) => ({
    value,
    ...(index === values.length - 1
      ? { dataPointRadius: 5, dataPointColor: "#FF7A1A" }
      : { hideDataPoint: true }),
  }));
  const traditionalData = [0, 3, 8, 13, 19, 25].map((value, index, values) => ({
    value,
    ...(index === values.length - 1
      ? { dataPointRadius: 3.5, dataPointColor: "#AAA39D" }
      : { hideDataPoint: true }),
  }));

  return (
    <View style={styles.progressSlide}>
      <View
        style={styles.progressChart}
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
      >
        <View pointerEvents="none" style={styles.progressYAxis}>
          {[100, 75, 50, 25, 0].map((value) => (
            <Text key={value} style={styles.progressYAxisLabel}>{value}%</Text>
          ))}
        </View>
        <LineChart
          data={coachData}
          data2={traditionalData}
          height={184}
          maxValue={100}
          noOfSections={4}
          stepValue={25}
          parentWidth={plotWidth || undefined}
          xAxisLength={plotWidth || undefined}
          yAxisLabelWidth={0}
          initialSpacing={edgeInset}
          endSpacing={edgeInset}
          spacing={spacing}
          xAxisLabelTexts={labels}
          xAxisLabelTextStyle={styles.progressXAxisLabel}
          yAxisTextStyle={styles.progressYAxisText}
          hideYAxisText
          yAxisThickness={0}
          xAxisThickness={0}
          rulesColor="rgba(255, 122, 26, 0.22)"
          rulesThickness={1}
          rulesType="solid"
          backgroundColor="transparent"
          curved
          curvature={0.16}
          isAnimated
          animationDuration={1_250}
          animateTogether
          thickness={5}
          thickness2={3.5}
          color="#FF7A1A"
          color2="#AAA39D"
          disableScroll
        />
      </View>
      <View style={styles.progressComparison}>
        <View style={[styles.progressOption, styles.progressOptionSelected]}>
          <View>
            <Text style={styles.progressOptionEyebrow}>WITH</Text>
            <Text style={styles.progressOptionTitle}>Court Coach AI</Text>
          </View>
          <Text style={styles.progressOptionMetric}>3x FASTER</Text>
        </View>
        <View style={[styles.progressOption, styles.progressOptionMuted]}>
          <View>
            <Text style={styles.progressOptionEyebrowMuted}>WITHOUT</Text>
            <Text style={[styles.progressOptionTitle, styles.progressOptionTitleMuted]}>Court Coach AI</Text>
          </View>
          <Text style={styles.progressOptionMetricMuted}>Traditional</Text>
        </View>
      </View>
    </View>
  );
}

function WhyCourtCoachComparison() {
  const comparisons = [
    ["Random drills", "AI personal coach"],
    ["No plan", "Smart workouts"],
    ["No tracking", "Progress insights"],
    ["No feedback", "Live coaching"],
    ["Manual logging", "Voice tracking"],
    ["No proof", "Share workouts"],
    ["Stagnant rank", "Boost overall"],
    ["Train alone", "Always guided"],
  ];

  return (
    <View style={styles.whyCourtCoachCard}>
      <View style={styles.comparisonHeadingRow}>
        <View style={styles.comparisonColumn}>
        <Text style={styles.withoutHeading}>WITHOUT{`\n`}COURT COACH</Text>
        </View>
        <View style={styles.comparisonDivider} />
        <View style={styles.comparisonColumn}>
        <Text style={styles.withHeading}>WITH{`\n`}COURT COACH</Text>
        </View>
      </View>
      {comparisons.map(([without, withCourtCoach], index) => (
        <View
          key={without}
          style={[styles.comparisonFullRow, index > 0 && styles.comparisonHorizontalLine]}
        >
          <View style={styles.comparisonColumn}>
            <View style={styles.comparisonRow}>
              <XCircleIcon size={19} color="#D94A45" weight="fill" />
              <Text style={styles.withoutComparisonText}>{without}</Text>
            </View>
          </View>
          <View style={styles.comparisonDivider} />
          <View style={styles.comparisonColumn}>
            <View style={styles.comparisonRow}>
              <CheckCircleIcon size={19} color="#35B96F" weight="fill" />
              <Text style={styles.withComparisonText}>{withCourtCoach}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const STEP_TITLES = [
  {
    title: "Training Alone Is Hard",
    subtitle:
      "Without a coach, it’s hard to know what to train or whether you’re improving. Many players repeat the same drills without a clear plan.",
  },
  {
    title: "Your AI Basketball Coach",
    subtitle:
      "Court Coach builds personalized workouts, guides each drill, and tracks your progress. Just talk to change drills, start timers, or log results.",
  },
  {
    title: "What should your Court Coach call you?",
    subtitle: "Your preferred name, nickname, or regular name all work.",
  },
  { title: "What's your skill level?", subtitle: "Be honest. This shapes your entire plan." },
  {
    title: "What level do you play?",
    subtitle: "Choose the level that best matches where you currently compete.",
  },
  { title: "What's your main goal?", subtitle: "Choose every goal that matters to you." },
  { title: "What position do you play?", subtitle: "Helps us pick drills that fit your position." },
  { title: "Your strengths", subtitle: "Choose every area you feel confident in." },
  { title: "Your weaknesses", subtitle: "Choose every area you want to improve." },
  { title: "Rate your skills", subtitle: "A quick skill assessment from 0 to 10." },
  { title: "Training days", subtitle: "How often can you train each week?" },
  { title: "Workout length", subtitle: "How much time do you have per workout?" },
  { title: "Workout intensity", subtitle: "Choose how challenging you want it to feel." },
  {
    title: "Preparing your first workouts",
    subtitle: "Reviewing your answers and preparing your personalized training setup.",
  },
  {
    title: "Just Talk",
    subtitle: "Connect your headphones through Bluetooth and just talk.",
  },
  {
    title: "Choose your coach",
    subtitle: "Pick the coaching style that feels best for you.",
  },
  {
    title: "Your Progress Potential",
    subtitle:
      "See how Court Coach accelerates your improvement compared to traditional training.",
  },
  {
    title: "Why Court Coach",
    subtitle: "Everything you need to train smarter in one place.",
  },
  {
    title: "Data and Privacy",
    subtitle:
      "Review how Court Coach uses data when you choose AI powered features.",
  },
];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ChipOption {
  label: string;
  value: string;
  icon?: React.ReactElement;
}

function CoachFeature({
  icon,
  title,
  description,
}: {
  icon: React.ReactElement<{
    size?: number;
    color?: string;
    weight?: "duotone";
  }>;
  title: string;
  description: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.coachFeature, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.coachFeatureIcon, { backgroundColor: colors.accentMuted }]}>
        {React.cloneElement(icon, {
          size: 22,
          color: colors.accent,
          weight: "duotone",
        })}
      </View>
      <View style={styles.coachFeatureCopy}>
        <Text style={[styles.coachFeatureTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.coachFeatureDescription, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

function ChipGroup({
  options,
  selected,
  onToggle,
  multi,
}: {
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multi?: boolean;
}) {
  const { colors, scheme } = useTheme();

  return (
    <View style={styles.chipGroup}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        const icon = opt.icon ?? <StarIcon />;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              selectionHaptic();
              onToggle(opt.value);
            }}
            style={({ pressed }) => [
              styles.chip,
              styles.chipVertical,
              {
                backgroundColor: active ? colors.accent : colors.cardAlt,
                borderColor: active ? colors.accent : colors.border,
                opacity: pressed ? 0.85 : 1,
              },
              active && {
                shadowColor: colors.accent,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: scheme === "dark" ? 0.4 : 0.28,
                shadowRadius: 8,
                elevation: 3,
              },
            ]}
          >
            <View style={styles.chipLabel}>
              {React.cloneElement(icon, {
                size: 21,
                color: active ? "#FFFFFF" : colors.accent,
                weight: "duotone",
              })}
            <Text
              style={[
                styles.chipText,
                { color: active ? "#FFFFFF" : colors.text },
              ]}
            >
              {opt.label}
            </Text>
            </View>
            {active ? (
              <CheckCircleIcon size={20} color="#FFFFFF" weight="fill" />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function skillLevelIcon(level: string) {
  switch (level) {
    case "beginner":
      return <StarIcon />;
    case "intermediate":
      return <TrendUpIcon />;
    case "advanced":
      return <MedalIcon />;
    default:
      return <CrownIcon />;
  }
}

function playingLevelIcon(level: string) {
  switch (level) {
    case "Elementary School":
      return <PersonSimpleWalkIcon />;
    case "Middle School":
      return <UserCircleIcon />;
    case "JV High School":
      return <TrendUpIcon />;
    case "Varsity High School":
      return <TrophyIcon />;
    case "College":
      return <MedalIcon />;
    default:
      return <CrownIcon />;
  }
}

function goalIcon(goal: string) {
  switch (goal) {
    case "Improve shooting":
      return <TargetIcon />;
    case "Improve handles":
      return <HandIcon />;
    case "Improve finishing":
      return <StarIcon />;
    case "Improve defense":
      return <ShieldIcon />;
    case "Get faster":
      return <PersonSimpleRunIcon />;
    case "Improve conditioning":
      return <HeartIcon />;
    case "Become stronger":
      return <BarbellIcon />;
    default:
      return <MedalIcon />;
  }
}

function skillIcon(skill: string) {
  switch (skill) {
    case "Shooting":
      return <TargetIcon />;
    case "Ball handling":
      return <BasketballIcon />;
    case "Finishing":
      return <StarIcon />;
    case "Defense":
      return <ShieldIcon />;
    case "Footwork":
      return <FootprintsIcon />;
    case "Conditioning":
      return <LightningIcon />;
    default:
      return <BarbellIcon />;
  }
}

function positionIcon(position: string) {
  switch (position) {
    case "Guard":
      return <UserCircleIcon />;
    case "Wing":
      return <ArrowsOutLineHorizontalIcon />;
    case "Big":
      return <ArrowsOutIcon />;
    default:
      return <QuestionIcon />;
  }
}

function dayOption(day: number): ChipOption {
  const icons = [
    <CalendarCheckIcon key="calendar" />,
    <FootprintsIcon key="footprints" />,
    <BasketballIcon key="basketball" />,
    <LightningIcon key="lightning" />,
    <TargetIcon key="target" />,
    <TrophyIcon key="trophy" />,
    <CrownIcon key="crown" />,
  ];
  return { label: String(day), value: String(day), icon: icons[day - 1] };
}

function minuteOption(minutes: number): ChipOption {
  const icons = [
    <AlarmIcon key="alarm" />,
    <ClockIcon key="clock" />,
    <TimerIcon key="timer" />,
    <WatchIcon key="watch" />,
    <HourglassLowIcon key="hourglass" />,
    <CalendarCheckIcon key="calendar" />,
  ];
  return { label: `${minutes} min`, value: String(minutes), icon: icons[MINUTES_OPTIONS.indexOf(minutes)] };
}

function intensityIcon(intensity: string) {
  switch (intensity) {
    case "Light":
      return <PersonSimpleWalkIcon />;
    case "Medium":
      return <TrophyIcon />;
    case "Hard":
      return <LightningIcon />;
    default:
      return <CrownIcon />;
  }
}

const styles = StyleSheet.create({
  error: {
    fontSize: 13,
    marginBottom: 16,
    fontWeight: "600",
  },
  coachChoiceList: {
    gap: 10,
  },
  coachChoice: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectedCoachOrb: {
    alignSelf: "center",
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  selectedCoachOrbIcon: {
    width: 62,
    height: 62,
  },
  coachChoiceCopy: {
    flex: 1,
  },
  coachChoiceStatus: {
    alignItems: "flex-end",
    gap: 6,
  },
  coachChoiceName: {
    fontSize: 16,
    fontWeight: "800",
  },
  coachChoiceDescription: {
    fontSize: 13,
    marginTop: 3,
  },
  coachChoiceRecommended: {
    fontSize: 12,
    fontWeight: "800",
  },
  coachChoiceFootnote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  groupLabel: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 14,
  },
  weaknessLabel: {
    marginTop: 24,
    marginBottom: 4,
  },
  chipGroup: {
    flexDirection: "column",
    gap: 12,
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  chipVertical: {
    width: "100%",
    justifyContent: "space-between",
  },
  chipLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  chipText: {
    fontWeight: "600",
    fontSize: 15,
  },
  checklist: {
    gap: 10,
  },
  checklistRow: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checklistIndicator: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  checklistText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  introSlide: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
  },
  problemImage: {
    width: 280,
    height: 280,
  },
  infoSlide: {
    alignItems: "center",
    gap: 18,
  },
  appLogo: {
    width: 150,
    height: 150,
  },
  infoLead: {
    maxWidth: 340,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },
  coachFeatures: {
    alignSelf: "stretch",
    gap: 10,
  },
  coachFeature: {
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  coachFeatureIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  coachFeatureCopy: {
    flex: 1,
    gap: 2,
  },
  coachFeatureTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  coachFeatureDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  progressSlide: {
    gap: 18,
    paddingTop: 4,
  },
  progressChart: {
    position: "relative",
    backgroundColor: "transparent",
    borderRadius: 32,
    overflow: "hidden",
    minHeight: 248,
    marginHorizontal: 7,
    paddingLeft: 36,
    paddingTop: 17,
    paddingBottom: 8,
    paddingRight: 36,
  },
  progressYAxis: {
    position: "absolute",
    left: 5,
    top: 20,
    bottom: 38,
    justifyContent: "space-between",
  },
  progressYAxisLabel: {
    color: "#8B827B",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "right",
  },
  progressYAxisText: {
    color: "transparent",
  },
  progressXAxisLabel: {
    color: "#756C65",
    fontSize: 9,
    fontWeight: "800",
  },
  progressComparison: {
    gap: 10,
  },
  progressOption: {
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  progressOptionSelected: {
    backgroundColor: "#FFF0E5",
    borderColor: "#FF7A1A",
    borderWidth: 1,
  },
  progressOptionMuted: {
    backgroundColor: "#F4F1EF",
    borderColor: "#DDD7D2",
  },
  progressOptionEyebrow: {
    color: "#FF7A1A",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  progressOptionEyebrowMuted: {
    color: "#9B938D",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  progressOptionTitle: {
    color: "#1F1916",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  progressOptionTitleMuted: {
    color: "#8B827B",
  },
  progressOptionMetric: {
    color: "#FF7A1A",
    fontSize: 13,
    fontWeight: "800",
  },
  progressOptionMetricMuted: {
    color: "#8B827B",
    fontSize: 13,
    fontWeight: "700",
  },
  whyCourtCoachCard: {
    minHeight: 452,
    borderRadius: 22,
    overflow: "hidden",
  },
  comparisonHeadingRow: {
    flexDirection: "row",
    minHeight: 76,
  },
  comparisonFullRow: {
    flexDirection: "row",
    minHeight: 47,
  },
  comparisonHorizontalLine: {
    borderTopColor: "#DDD6D0",
    borderTopWidth: 1,
  },
  comparisonColumn: {
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  comparisonDivider: {
    width: 1,
    backgroundColor: "#D4CCC5",
  },
  withoutHeading: {
    color: "#D94A45",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.7,
    lineHeight: 17,
    marginBottom: 0,
  },
  withHeading: {
    color: "#FF7A1A",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.7,
    lineHeight: 17,
    marginBottom: 0,
  },
  comparisonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  withoutComparisonText: {
    color: "#8D8580",
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  withComparisonText: {
    color: "#251D19",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  consentSlide: {
    gap: 18,
    paddingBottom: 8,
  },
  consentNotNow: {
    width: "100%",
  },
});
