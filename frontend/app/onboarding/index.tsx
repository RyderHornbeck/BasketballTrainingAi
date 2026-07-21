import { OnboardingStep } from "@/components/OnboardingStep";
import { SkillSlider } from "@/components/SkillSlider";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { requestOnboardingReviewOnce } from "@/lib/appReview";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { OnboardingFormData } from "@/types/plan";
import { Text } from "@/components/Text";
import { router } from "expo-router";
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
  NumberFiveIcon,
  NumberFourIcon,
  NumberOneIcon,
  NumberSevenIcon,
  NumberSixIcon,
  NumberThreeIcon,
  NumberTwoIcon,
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
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite"];
const GOALS = [
  "Make the team",
  "Improve shooting",
  "Improve handles",
  "Improve finishing",
  "Improve defense",
  "Get faster",
  "Improve conditioning",
  "Become stronger",
  "Become an all-around better player",
];
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

const QUESTION_STEPS = 9;
const PRE_SIGNUP_STEP = 10;
const COACH_INTRO_STEP = 11;
const REVIEW_STEP = 12;
const PRE_SIGNUP_TOTAL_STEPS = REVIEW_STEP;
const GENERATION_STEPS = [
  "Calculating your workout length",
  "Reading your goals and skill levels",
  "Finding exercises tailored to you",
  "Balancing drill categories and difficulty",
  "Scheduling your first five workouts",
];
const CHECKLIST_STEP_MS = 1_000;

const initialForm: OnboardingFormData = {
  overall_skill_level: "",
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
  days_per_week: 3,
  minutes_per_workout: 45,
  has_court_access: true,
  equipment: ["Basketball"],
  injuries_limitations: "",
  preferred_intensity: "",
};

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingFormData>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedChecklistSteps, setCompletedChecklistSteps] = useState(0);
  const [checklistRun, setChecklistRun] = useState(0);
  const totalSteps = user ? QUESTION_STEPS : PRE_SIGNUP_TOTAL_STEPS;

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

  useEffect(() => {
    if (user || step !== REVIEW_STEP) return;
    void requestOnboardingReviewOnce();
  }, [step, user]);

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

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return !!form.overall_skill_level;
      case 2:
        return !!form.main_goal;
      case 3:
        return !!form.position;
      case 4:
        return true;
      case 5:
        return true;
      case 6:
        return true;
      case 7:
        return true;
      case 8:
        return true;
      case 9:
        return !!form.preferred_intensity;
      case PRE_SIGNUP_STEP:
        return completedChecklistSteps === GENERATION_STEPS.length;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (step < QUESTION_STEPS) {
      if (!user) await saveOnboardingDraft(form);
      setStep(step + 1);
      return;
    }
    if (step === QUESTION_STEPS && !user) {
      await saveOnboardingDraft(form);
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
      setStep(REVIEW_STEP);
      return;
    }
    await handleSubmit();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (user) {
        // Existing authenticated accounts can complete onboarding here.
        // Start their real plan behind the paywall so it can be ready after purchase.
        await submitOnboardingAnswers(user.id, form);
        await clearOnboardingDraft();
        await refreshProfile();
        router.replace({
          pathname: "/paywall",
          params: { next: "generating" },
        });
        void requestPlanGeneration().catch((generationError) => {
          console.error("Unable to start initial plan generation:", generationError);
        });
        return;
      }

      // Normal path: no account yet. Stash the answers locally and move on
      // to account creation -- they get written to Supabase right after
      // signup succeeds.
      await saveOnboardingDraft(form);
      router.push("/auth/signup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
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
      step={step}
      totalSteps={totalSteps}
      onNext={handleNext}
      onBack={handleBack}
      nextDisabled={!canGoNext()}
      nextLoading={submitting}
      nextLabel={
        step === REVIEW_STEP
          ? "I rated"
          : step === QUESTION_STEPS && user
            ? "Build My Plan"
            : "Continue"
      }
    >
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {step === 1 && (
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

      {step === 2 && (
        <ChipGroup
          options={GOALS.map((goal) => ({ label: goal, value: goal, icon: goalIcon(goal) }))}
          selected={selectedTextValues(form.main_goal)}
          onToggle={(value) => toggleTextSelection("main_goal", value)}
        />
      )}

      {step === 3 && (
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

      {step === 4 && (
        <View>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Choose every area you feel confident in.
          </Text>
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

      {step === 5 && (
        <View>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Choose every area that needs extra work.
          </Text>
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

      {step === 6 && (
        <View>
          <SkillSlider label="Shooting" value={Number(form.shooting_level)} onChange={(v) => update("shooting_level", String(v))} />
          <SkillSlider label="Ball Handling" value={Number(form.ball_handling_level)} onChange={(v) => update("ball_handling_level", String(v))} />
          <SkillSlider label="Finishing" value={Number(form.finishing_level)} onChange={(v) => update("finishing_level", String(v))} />
          <SkillSlider label="Defense" value={Number(form.defense_level)} onChange={(v) => update("defense_level", String(v))} />
          <SkillSlider label="Conditioning" value={Number(form.conditioning_level)} onChange={(v) => update("conditioning_level", String(v))} />
          <SkillSlider label="Athleticism" value={Number(form.athleticism_level)} onChange={(v) => update("athleticism_level", String(v))} />
          <SkillSlider label="Strength" value={Number(form.strength_level)} onChange={(v) => update("strength_level", String(v))} />
        </View>
      )}

      {step === 7 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Days per week you can train</Text>
          <ChipGroup
            options={DAYS_PER_WEEK_OPTIONS.map((day) => dayOption(day))}
            selected={[String(form.days_per_week)]}
            onToggle={(v) => update("days_per_week", Number(v))}
          />
        </View>
      )}

      {step === 8 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Minutes per workout</Text>
          <ChipGroup
            options={MINUTES_OPTIONS.map((minutes) => minuteOption(minutes))}
            selected={[String(form.minutes_per_workout)]}
            onToggle={(v) => update("minutes_per_workout", Number(v))}
          />
        </View>
      )}

      {step === 9 && (
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
            Court Coach helps you move through every workout more smoothly, stay organized, and
            focus on improving your game.
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

      {step === REVIEW_STEP && !user && (
        <View style={styles.ratingSlide}>
          <View style={styles.ratingStars}>
            {Array.from({ length: 5 }, (_, index) => (
              <StarIcon key={index} size={34} color="#FBBF24" weight="fill" />
            ))}
          </View>
          <Image
            source={require("../../assets/images/AppLogo.png")}
            style={styles.ratingLogo}
            resizeMode="contain"
          />
          <Text style={[styles.ratingCopy, { color: colors.textSecondary }]}>
            Your rating helps more basketball players discover smarter, easier training with Court
            Coach.
          </Text>
        </View>
      )}
    </OnboardingStep>
  );
}

const STEP_TITLES = [
  { title: "What's your skill level?", subtitle: "Be honest -- this shapes your entire plan." },
  { title: "What's your main goal?", subtitle: "Choose every goal that matters to you." },
  { title: "What position do you play?", subtitle: "Helps us pick position-relevant drills." },
  { title: "Your strengths", subtitle: "Choose every area you feel confident in." },
  { title: "Your weaknesses", subtitle: "Choose every area you want to improve." },
  { title: "Rate your skills", subtitle: "A quick self-assessment, 0 to 10." },
  { title: "Training days", subtitle: "How often can you train each week?" },
  { title: "Workout length", subtitle: "How much time do you have per workout?" },
  { title: "Workout intensity", subtitle: "Last step -- choose how challenging you want it to feel." },
  {
    title: "Preparing your first workouts",
    subtitle: "Reviewing your answers and preparing your personalized training setup.",
  },
  {
    title: "Train smarter with Court Coach",
    subtitle: "Your AI coach keeps each workout simple, flexible, and on track.",
  },
  {
    title: "Give Court Coach a rating",
    subtitle: "If you’re excited to start training, support Court Coach with a quick rating.",
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
            onPress={() => onToggle(opt.value)}
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

function goalIcon(goal: string) {
  switch (goal) {
    case "Make the team":
      return <TrophyIcon />;
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
    <NumberOneIcon key="one" />,
    <NumberTwoIcon key="two" />,
    <NumberThreeIcon key="three" />,
    <NumberFourIcon key="four" />,
    <NumberFiveIcon key="five" />,
    <NumberSixIcon key="six" />,
    <NumberSevenIcon key="seven" />,
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
  groupLabel: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 14,
  },
  weaknessLabel: {
    marginTop: 24,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
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
  ratingSlide: {
    minHeight: 390,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  ratingStars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  ratingLogo: {
    width: 190,
    height: 190,
  },
  ratingCopy: {
    maxWidth: 330,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
