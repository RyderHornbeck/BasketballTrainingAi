import { OnboardingStep } from "@/components/OnboardingStep";
import { SkillSlider } from "@/components/SkillSlider";
import { TextInput } from "@/components/TextInput";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { loadOnboardingDraft, saveOnboardingDraft } from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { OnboardingFormData } from "@/types/plan";
import { Text } from "@/components/Text";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

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
const EQUIPMENT_OPTIONS = ["Basketball", "Cones", "Resistance bands", "Weights", "None"];
const INTENSITY_OPTIONS = ["Light", "Medium", "Hard", "Extremely hard"];
const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const MINUTES_OPTIONS = [15, 30, 45, 60, 75, 90];

const TOTAL_STEPS = 8;

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

  // Already finished onboarding — don't make them answer again.
  useEffect(() => {
    if (!authLoading && profile?.onboarding_completed) {
      router.replace("/");
    }
  }, [authLoading, profile]);

  // If someone lands back here (e.g. tapped "Back" from the signup screen,
  // or resumed the app before creating an account), restore anything they'd
  // already filled in rather than starting the questionnaire over.
  useEffect(() => {
    if (user) return;
    loadOnboardingDraft().then((draft) => {
      if (draft) setForm(draft);
    });
  }, [user]);

  const update = <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleEquipment = (option: string) => {
    setForm((prev) => {
      if (option === "None") {
        return { ...prev, equipment: prev.equipment.includes("None") ? [] : ["None"] };
      }
      const withoutNone = prev.equipment.filter((e) => e !== "None");
      const has = withoutNone.includes(option);
      return {
        ...prev,
        equipment: has ? withoutNone.filter((e) => e !== option) : [...withoutNone, option],
      };
    });
  };

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
        return form.equipment.length > 0;
      case 8:
        return !!form.preferred_intensity;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (step < TOTAL_STEPS) {
      if (!user) await saveOnboardingDraft(form);
      setStep(step + 1);
      return;
    }
    await handleSubmit();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (user) {
        // Rare fallback: someone is already authenticated but never
        // finished onboarding (e.g. an existing account created before
        // this flow, or the app was killed mid-flow). Submit directly.
        await submitOnboardingAnswers(user.id, form);
        await refreshProfile();
        await requestPlanGeneration();
        router.replace("/generating");
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
    if (step > 1) setStep(step - 1);
  };

  return (
    <OnboardingStep
      title={STEP_TITLES[step - 1].title}
      subtitle={STEP_TITLES[step - 1].subtitle}
      step={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onBack={step > 1 ? handleBack : undefined}
      nextDisabled={!canGoNext()}
      nextLoading={submitting}
      nextLabel={step === TOTAL_STEPS ? (user ? "Build My Plan" : "Create Account") : "Continue"}
    >
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      {step === 1 && (
        <ChipGroup
          options={SKILL_LEVELS.map((l) => ({ label: capitalize(l), value: l }))}
          selected={[form.overall_skill_level]}
          onToggle={(v) => update("overall_skill_level", v)}
        />
      )}

      {step === 2 && (
        <ChipGroup
          options={GOALS.map((g) => ({ label: g, value: g }))}
          selected={[form.main_goal]}
          onToggle={(v) => update("main_goal", v)}
          vertical
        />
      )}

      {step === 3 && (
        <ChipGroup
          options={POSITIONS.map((p) => ({ label: p, value: p }))}
          selected={[form.position]}
          onToggle={(v) => update("position", v)}
        />
      )}

      {step === 4 && (
        <View>
          <TextInput
            label="Your strengths"
            placeholder="e.g. Quick first step, good court vision"
            value={form.strengths}
            onChangeText={(v) => update("strengths", v)}
            multiline
            style={styles.multiline}
          />
          <TextInput
            label="Your weaknesses"
            placeholder="e.g. Left hand finishing, catch-and-shoot"
            value={form.weaknesses}
            onChangeText={(v) => update("weaknesses", v)}
            multiline
            style={styles.multiline}
          />
        </View>
      )}

      {step === 5 && (
        <View>
          <SkillSlider label="Shooting" value={Number(form.shooting_level)} onChange={(v) => update("shooting_level", String(v))} />
          <SkillSlider label="Ball Handling" value={Number(form.ball_handling_level)} onChange={(v) => update("ball_handling_level", String(v))} />
          <SkillSlider label="Finishing" value={Number(form.finishing_level)} onChange={(v) => update("finishing_level", String(v))} />
          <SkillSlider label="Defense" value={Number(form.defense_level)} onChange={(v) => update("defense_level", String(v))} />
          <SkillSlider label="Basketball IQ" value={Number(form.basketball_iq_level)} onChange={(v) => update("basketball_iq_level", String(v))} />
          <SkillSlider label="Conditioning" value={Number(form.conditioning_level)} onChange={(v) => update("conditioning_level", String(v))} />
          <SkillSlider label="Athleticism" value={Number(form.athleticism_level)} onChange={(v) => update("athleticism_level", String(v))} />
          <SkillSlider label="Strength" value={Number(form.strength_level)} onChange={(v) => update("strength_level", String(v))} />
        </View>
      )}

      {step === 6 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Days per week you can train</Text>
          <ChipGroup
            options={DAYS_PER_WEEK_OPTIONS.map((d) => ({ label: String(d), value: String(d) }))}
            selected={[String(form.days_per_week)]}
            onToggle={(v) => update("days_per_week", Number(v))}
          />
          <Text style={[styles.groupLabel, { color: colors.text, marginTop: 24 }]}>Minutes per workout</Text>
          <ChipGroup
            options={MINUTES_OPTIONS.map((m) => ({ label: `${m} min`, value: String(m) }))}
            selected={[String(form.minutes_per_workout)]}
            onToggle={(v) => update("minutes_per_workout", Number(v))}
          />
        </View>
      )}

      {step === 7 && (
        <View>
          <Text style={[styles.groupLabel, { color: colors.text }]}>Do you have access to a hoop/court?</Text>
          <ChipGroup
            options={[{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]}
            selected={[form.has_court_access ? "yes" : "no"]}
            onToggle={(v) => update("has_court_access", v === "yes")}
          />
          <Text style={[styles.groupLabel, { color: colors.text, marginTop: 24 }]}>Equipment available</Text>
          <ChipGroup
            options={EQUIPMENT_OPTIONS.map((e) => ({ label: e, value: e }))}
            selected={form.equipment}
            onToggle={toggleEquipment}
            multi
          />
        </View>
      )}

      {step === 8 && (
        <View>
          <TextInput
            label="Injuries or limitations (optional)"
            placeholder="e.g. Recovering from ankle sprain"
            value={form.injuries_limitations}
            onChangeText={(v) => update("injuries_limitations", v)}
            multiline
            style={styles.multiline}
          />
          <Text style={[styles.groupLabel, { color: colors.text, marginTop: 24 }]}>Preferred workout intensity</Text>
          <ChipGroup
            options={INTENSITY_OPTIONS.map((i) => ({ label: i, value: i }))}
            selected={[form.preferred_intensity]}
            onToggle={(v) => update("preferred_intensity", v)}
          />
        </View>
      )}
    </OnboardingStep>
  );
}

const STEP_TITLES = [
  { title: "What's your skill level?", subtitle: "Be honest -- this shapes your entire plan." },
  { title: "What's your main goal?", subtitle: "We'll build your plan around this." },
  { title: "What position do you play?", subtitle: "Helps us pick position-relevant drills." },
  { title: "Strengths & weaknesses", subtitle: "Tell us what's working and what needs work." },
  { title: "Rate your skills", subtitle: "A quick self-assessment, 1 to 10." },
  { title: "Your training schedule", subtitle: "How often and how long can you train?" },
  { title: "Court access & equipment", subtitle: "We'll adapt drills to what you have." },
  { title: "Injuries & intensity", subtitle: "Last step -- let's dial in the difficulty." },
];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ChipOption {
  label: string;
  value: string;
}

function ChipGroup({
  options,
  selected,
  onToggle,
  multi,
  vertical,
}: {
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multi?: boolean;
  vertical?: boolean;
}) {
  const { colors, scheme } = useTheme();

  return (
    <View style={[styles.chipGroup, vertical && styles.chipGroupVertical]}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <Pressable
            key={opt.value}
            onPress={() => onToggle(opt.value)}
            style={({ pressed }) => [
              styles.chip,
              vertical && styles.chipVertical,
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
            <Text
              style={[
                styles.chipText,
                { color: active ? "#FFFFFF" : colors.text },
              ]}
            >
              {opt.label}
            </Text>
            {vertical && active ? (
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
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
  chipGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chipGroupVertical: {
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
  chipText: {
    fontWeight: "600",
    fontSize: 15,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: "top",
  },
});
