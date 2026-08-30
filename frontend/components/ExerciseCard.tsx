import { useTheme } from "@/hooks/useTheme";
import {
  aggregateSetLogs,
  applyAttemptsOverride,
  applyMinutesOverride,
  buildSetPlan,
  decodeExerciseLogMeta,
  encodeExerciseLogMeta,
  hydrateSetLogs,
  normalizeSetLogs,
  resolveAttemptsOverride,
  resolveMinutesOverride,
  SetLogEntry,
  targetAttemptsForSet,
  targetMakesForSet,
} from "@/lib/exerciseSetLogs";
import { ExerciseLogInput } from "@/lib/plan";
import { reportNetworkFailure } from "@/lib/connectivity";
import { completionHaptic } from "@/lib/haptics";
import { buildYouTubeClipHtml } from "@/lib/youtubePlayer";
import { hasVideoDemo } from "@/lib/exerciseClip";
import { parseDrillDescription } from "@/lib/drillDescription";
import { WorkoutExerciseWithClip } from "@/types/plan";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { CaretLeftIcon, CaretRightIcon, TimerIcon, XIcon } from "phosphor-react-native";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  TextInput as RNTextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Card } from "./Card";
import { Text } from "./Text";

interface ExerciseCardProps {
  exercise: WorkoutExerciseWithClip;
  readOnly?: boolean;
  editMode?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  completionAnimationToken?: number;
  onDelete?: () => void;
  onLogChange: (log: ExerciseLogInput) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  shooting: "Shooting",
  ball_handling: "Ball Handling",
  finishing: "Finishing",
  defense: "Defense",
  footwork: "Footwork",
  conditioning: "Conditioning",
  strength: "Strength",
  warmup: "Warmup",
  cooldown: "Cooldown",
  mobility: "Mobility",
  basketball_iq: "Discipline",
};
const TIMED_CATEGORIES = new Set(["ball_handling", "defense", "defensive", "conditioning"]);

function formatSetDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0
    ? `${minutes} min`
    : `${minutes} min ${remainder} sec`;
}

function SetCheckboxRow({
  label,
  completed,
  onToggle,
  readOnly,
  colors,
}: {
  label: string;
  completed: boolean;
  onToggle: () => void;
  readOnly?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable
      onPress={readOnly ? undefined : onToggle}
      disabled={readOnly}
      hitSlop={4}
      pressRetentionOffset={28}
      style={({ pressed }) => [
        styles.setRow,
        {
          backgroundColor: completed ? colors.accentMuted : colors.cardAlt,
          borderColor: colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: completed ? colors.accent : "transparent",
            borderColor: colors.accent,
          },
        ]}
      >
        {completed ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={[styles.setRowLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.setRowHint, { color: colors.textMuted }]}>
        {completed ? "Done" : "Tap when finished"}
      </Text>
    </Pressable>
  );
}

function SetShootingRow({
  setNumber,
  sideLabel,
  makes,
  attempts,
  targetAttempts,
  targetMakes,
  targetAttemptsDraft,
  targetMakesDraft,
  editMode,
  completed,
  makesDraft,
  attemptsDraft,
  onMakesChange,
  onAttemptsChange,
  onTargetAttemptsChange,
  onTargetMakesChange,
  onCommit,
  readOnly,
  colors,
}: {
  setNumber: number;
  sideLabel?: string | null;
  makes: string;
  attempts: string;
  targetAttempts: number | null;
  targetMakes: number | null;
  targetAttemptsDraft?: string | null;
  targetMakesDraft?: string | null;
  editMode: boolean;
  completed: boolean;
  makesDraft?: string | null;
  attemptsDraft?: string | null;
  onMakesChange: (value: string) => void;
  onAttemptsChange: (value: string) => void;
  onTargetAttemptsChange: (value: string) => void;
  onTargetMakesChange: (value: string) => void;
  onCommit: () => void;
  readOnly?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.setRow,
        styles.shootingSetRow,
        {
          backgroundColor: completed ? colors.accentMuted : colors.cardAlt,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.setHeaderRow}>
        <View style={styles.setTitleGroup}>
          <Text style={[styles.setNumber, { color: colors.text }]}>Set {setNumber}</Text>
          {sideLabel ? (
            <Text style={[styles.sideLabel, { color: colors.accent }]}>{sideLabel}</Text>
          ) : null}
        </View>
        {editMode ? (
          <View style={styles.targetEditor}>
            <RNTextInput
              value={targetMakesDraft ?? String(targetMakes ?? 0)}
              onChangeText={onTargetMakesChange}
              keyboardType="number-pad"
              inputMode="numeric"
              style={[styles.targetInput, { color: colors.text, borderColor: colors.accent }]}
            />
            <Text style={[styles.shootingSlash, { color: colors.textMuted }]}>/</Text>
            <RNTextInput
              value={targetAttemptsDraft ?? String(targetAttempts ?? 0)}
              onChangeText={onTargetAttemptsChange}
              keyboardType="number-pad"
              inputMode="numeric"
              style={[styles.targetInput, { color: colors.text, borderColor: colors.accent }]}
            />
          </View>
        ) : targetMakes != null ? (
          <Text style={[styles.setTargetHint, { color: colors.textMuted }]}>
            Target {targetMakes}
            {targetAttempts != null ? `/${targetAttempts}` : ""}
          </Text>
        ) : null}
      </View>
      <View style={styles.shootingInputs}>
        <View style={styles.shootingCol}>
          <Text style={[styles.shootingLabel, { color: colors.textSecondary }]}>Makes</Text>
          <RNTextInput
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            value={makesDraft ?? makes}
            onChangeText={readOnly ? undefined : onMakesChange}
            editable={!readOnly}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.shootingInput,
              { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
            ]}
          />
        </View>
        <Text style={[styles.shootingSlash, { color: colors.textMuted }]}>/</Text>
        <View style={styles.shootingCol}>
          <Text style={[styles.shootingLabel, { color: colors.textSecondary }]}>Attempts</Text>
          <RNTextInput
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            value={attemptsDraft ?? attempts}
            onChangeText={readOnly ? undefined : onAttemptsChange}
            editable={!readOnly}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder={targetAttempts != null ? String(targetAttempts) : "0"}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.shootingInput,
              { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
            ]}
          />
        </View>
        <Pressable
          onPress={readOnly ? undefined : onCommit}
          disabled={readOnly}
          style={[
            styles.checkbox,
            {
              backgroundColor: completed ? colors.accent : "transparent",
              borderColor: colors.accent,
            },
          ]}
        >
          {completed ? <Text style={styles.checkmark}>✓</Text> : null}
        </Pressable>
      </View>
    </View>
  );
}

function DrillDescriptionView({
  description,
  colors,
  compact,
}: {
  description: string;
  colors: ReturnType<typeof useTheme>["colors"];
  compact?: boolean;
}) {
  const parsed = useMemo(() => parseDrillDescription(description), [description]);

  return (
    <View style={[styles.drillDescription, compact && styles.drillDescriptionCompact]}>
      {parsed.intro ? (
        <Text style={[styles.drillIntro, { color: colors.textSecondary }]}>
          {parsed.intro.replace(/\.\s*$/, "")}.
        </Text>
      ) : null}
      {parsed.steps.map((step) => (
        <View key={step.number} style={styles.drillStepRow}>
          <Text style={[styles.drillStepLabel, { color: colors.text }]}>
            Step {step.number}:{" "}
            <Text style={[styles.drillStepText, { color: colors.textSecondary }]}>
              {step.text}
            </Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ExerciseCard({
  exercise,
  readOnly,
  editMode = false,
  expanded: expandedProp,
  onExpandedChange,
  completionAnimationToken,
  onDelete,
  onLogChange,
}: ExerciseCardProps) {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const completionScale = useRef(new Animated.Value(1)).current;
  const seenCompletionTokenRef = useRef<number | undefined>(completionAnimationToken);
  const previousExerciseIdRef = useRef(exercise.id);

  const baseSetPlan = useMemo(() => {
    const plan = buildSetPlan(exercise);
    if (!TIMED_CATEGORIES.has((exercise.category ?? "").toLowerCase())) return plan;
    return {
      ...plan,
      logType: "minutes" as const,
      perSetMinutes: Math.max(1, Math.min(3, plan.perSetMinutes ?? 2)),
    };
  }, [exercise]);
  const [attemptsOverride, setAttemptsOverride] = useState<number | null>(() => {
    const meta = decodeExerciseLogMeta(exercise.log?.notes ?? null);
    const logs = hydrateSetLogs(baseSetPlan, meta, exercise.log ?? undefined);
    return resolveAttemptsOverride(meta, logs);
  });
  const [minutesOverride, setMinutesOverride] = useState<number | null>(() =>
    resolveMinutesOverride(decodeExerciseLogMeta(exercise.log?.notes ?? null))
  );
  const [attemptsDrafts, setAttemptsDrafts] = useState<Record<number, string>>({});
  const [makesDrafts, setMakesDrafts] = useState<Record<number, string>>({});
  const [targetAttemptsDrafts, setTargetAttemptsDrafts] = useState<Record<number, string>>({});
  const [targetMakesDrafts, setTargetMakesDrafts] = useState<Record<number, string>>({});
  const setPlan = useMemo(
    () => applyMinutesOverride(applyAttemptsOverride(baseSetPlan, attemptsOverride), minutesOverride),
    [baseSetPlan, attemptsOverride, minutesOverride]
  );
  const logType = setPlan.logType;

  const [setLogs, setSetLogs] = useState<SetLogEntry[]>(() =>
    hydrateSetLogs(setPlan, decodeExerciseLogMeta(exercise.log?.notes ?? null), exercise.log ?? undefined)
  );
  const [difficulty, setDifficulty] = useState(exercise.log?.difficulty ?? 0);
  const [userNotes, setUserNotes] = useState(
    () => decodeExerciseLogMeta(exercise.log?.notes ?? null).user_notes ?? ""
  );
  const hasUserEditsRef = useRef(false);

  const normalizedSets = useMemo(() => normalizeSetLogs(setLogs, setPlan), [setLogs, setPlan]);
  const aggregated = useMemo(
    () => aggregateSetLogs(normalizedSets, setPlan),
    [normalizedSets, setPlan]
  );
  const completed = aggregated.completed || (logType === "difficulty_rating" && difficulty > 0);

  useEffect(() => {
    const meta = decodeExerciseLogMeta(exercise.log?.notes ?? null);
    const hydrated = hydrateSetLogs(baseSetPlan, meta, exercise.log ?? undefined);
    setAttemptsOverride(resolveAttemptsOverride(meta, hydrated));
    setMinutesOverride(resolveMinutesOverride(meta));
    setAttemptsDrafts({});
    setMakesDrafts({});
    setTargetAttemptsDrafts({});
    setTargetMakesDrafts({});
    setSetLogs(hydrated);
    setDifficulty(exercise.log?.difficulty ?? 0);
    setUserNotes(meta.user_notes ?? "");
    hasUserEditsRef.current = false;
    if (previousExerciseIdRef.current !== exercise.id) {
      previousExerciseIdRef.current = exercise.id;
      setInternalExpanded(false);
      setVideoStarted(false);
      setVideoError(false);
    }
  }, [exercise.id, exercise.log, baseSetPlan]);

  useEffect(() => {
    if (
      completionAnimationToken == null ||
      completionAnimationToken === seenCompletionTokenRef.current
    ) {
      return;
    }
    seenCompletionTokenRef.current = completionAnimationToken;
    completionScale.setValue(0.72);
    Animated.spring(completionScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 160,
    }).start();
  }, [completionAnimationToken, completionScale]);

  const clip = exercise.video_clip;
  const showVideo = hasVideoDemo(clip);
  const descriptionText =
    clip?.description ?? exercise.instructions ?? clip?.coaching_notes ?? null;
  const hasDrillTimer = logType === "minutes" && setPlan.perSetMinutes != null;
  const watchUrl = clip
    ? `https://www.youtube.com/watch?v=${clip.youtube_video_id}&t=${clip.start_seconds}s`
    : null;

  const videoHtml = useMemo(() => {
    if (!showVideo || !clip || !videoStarted) return null;
    return buildYouTubeClipHtml(clip.youtube_video_id, clip.start_seconds, clip.end_seconds, {
      autoplay: true,
    });
  }, [clip, videoStarted]);

  const emitLog = (
    nextSets: SetLogEntry[],
    nextDifficulty = difficulty,
    nextNotes = userNotes,
    nextAttemptsOverride = attemptsOverride,
    nextMinutesOverride = minutesOverride
  ) => {
    const normalized = normalizeSetLogs(nextSets, setPlan);
    const totals = aggregateSetLogs(normalized, setPlan);
    const drillComplete =
      logType === "difficulty_rating" ? nextDifficulty > 0 : totals.completed;

    onLogChange({
      exercise_id: exercise.id,
      completed: drillComplete,
      makes: totals.makes,
      attempts: totals.attempts,
      minutes_completed: totals.minutes_completed,
      difficulty: logType === "difficulty_rating" ? nextDifficulty || null : null,
      notes: encodeExerciseLogMeta({
        set_logs: normalized,
        user_notes: nextNotes.trim() || null,
        per_set_attempts_override: nextAttemptsOverride,
        per_set_minutes_override: nextMinutesOverride,
      }),
    });
  };

  const updateSet = (setNumber: number, patch: Partial<SetLogEntry>) => {
    hasUserEditsRef.current = true;
    setSetLogs((prev) =>
      prev.map((row) => (row.set_number === setNumber ? { ...row, ...patch } : row))
    );
  };

  useEffect(() => {
    if (!hasUserEditsRef.current) return;
    emitLog(setLogs, difficulty, userNotes, attemptsOverride, minutesOverride);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLogs, difficulty, userNotes, attemptsOverride, minutesOverride, setPlan]);

  const saveShootingSet = (setNumber: number) => {
    const makes = makesDrafts[setNumber] === ""
      ? null
      : Number.parseInt(makesDrafts[setNumber] ?? "0", 10);
    const requestedAttempts = attemptsDrafts[setNumber] === ""
      ? 0
      : Number.parseInt(attemptsDrafts[setNumber] ?? "0", 10);
    const row = setLogs.find((set) => set.set_number === setNumber);
    const attempts = Number.isFinite(requestedAttempts)
      ? requestedAttempts
      : row?.attempts ?? 0;
    const targetMakes = Number.parseInt(
      targetMakesDrafts[setNumber] ?? String(targetMakesForSet(row!, setPlan) ?? 0),
      10,
    );
    const targetAttempts = Number.parseInt(
      targetAttemptsDrafts[setNumber] ?? String(targetAttemptsForSet(row!, setPlan) ?? 0),
      10,
    );
    if ((makes ?? 0) > attempts) {
      Alert.alert("Makes can’t exceed attempts", "Adjust the result before saving this set.");
      return;
    }
    if (!Number.isFinite(makes ?? 0) || attempts < 0) return;
    if (!Number.isFinite(targetMakes) || !Number.isFinite(targetAttempts) || targetMakes < 0 ||
      targetAttempts < 1 || targetMakes > targetAttempts || targetMakes < (makes ?? 0) ||
      targetAttempts < attempts) {
      Alert.alert("Invalid set target", "Targets must be valid and cannot be below this set's results.");
      return;
    }
    hasUserEditsRef.current = true;
    setSetLogs((previous) =>
      previous.map((set) => ({
        ...set,
        makes: set.set_number === setNumber ? makes : set.makes,
        attempts: set.set_number === setNumber ? attempts : set.attempts,
        target_makes_override: set.set_number === setNumber ? targetMakes : set.target_makes_override,
        target_attempts_override: set.set_number === setNumber
          ? targetAttempts
          : set.target_attempts_override,
        completed: set.set_number === setNumber ? true : set.completed,
      }))
    );
    setMakesDrafts((drafts) => {
      const next = { ...drafts };
      delete next[setNumber];
      return next;
    });
    setAttemptsDrafts((drafts) => {
      const next = { ...drafts };
      delete next[setNumber];
      return next;
    });
    setTargetMakesDrafts((drafts) => {
      const next = { ...drafts };
      delete next[setNumber];
      return next;
    });
    setTargetAttemptsDrafts((drafts) => {
      const next = { ...drafts };
      delete next[setNumber];
      return next;
    });
  };

  const toggleSetComplete = (setNumber: number) => {
    const row = setLogs.find((s) => s.set_number === setNumber);
    if (!row) return;
    const next = !row.completed;
    if (next) completionHaptic();
    const setMinutes =
      row.duration_seconds_override != null
        ? row.duration_seconds_override / 60
        : setPlan.perSetMinutes;
    updateSet(setNumber, {
      completed: next,
      minutes: next ? setMinutes : null,
    });
  };

  const expanded = expandedProp ?? internalExpanded;
  const toggleExpand = () => {
    const next = !expanded;
    onExpandedChange?.(next);
    if (expandedProp == null) setInternalExpanded(next);
  };

  const openInYouTube = () => {
    if (watchUrl) Linking.openURL(watchUrl);
  };

  const openDrillTimer = () => {
    const currentSet = normalizedSets.find((set) => !set.completed) ?? normalizedSets[0];
    if (!currentSet || !setPlan.perSetMinutes) return;
    const durationSeconds =
      currentSet.duration_seconds_override ??
      Math.round(setPlan.perSetMinutes * 60);
    router.push({
      pathname: "/drill-timer",
      params: {
        name: exercise.name ?? "Drill",
        instructions: descriptionText ?? "",
        durationSeconds: String(durationSeconds),
        setNumber: String(currentSet.set_number),
        exerciseId: exercise.id,
        dayId: exercise.day_id,
      },
    });
  };

  const adjustSetTimer = (secondsDelta: number) => {
    if (!setPlan.perSetMinutes) return;
    hasUserEditsRef.current = true;
    const changed = setLogs.filter((set) => set.duration_seconds_override != null);
    const unchanged = setLogs.filter((set) => set.duration_seconds_override == null);
    const targetSetNumbers =
      changed.length === 0
        ? new Set(setLogs.map((set) => set.set_number))
        : unchanged.length > 0
          ? new Set(unchanged.map((set) => set.set_number))
          : new Set(
              changed.every(
                (set) =>
                  set.duration_seconds_override === changed[0].duration_seconds_override
              )
                ? changed.map((set) => set.set_number)
                : [Math.max(...changed.map((set) => set.set_number))]
            );
    setMinutesOverride(null);
    setSetLogs((previous) =>
      previous.map((set) => {
        if (!targetSetNumbers.has(set.set_number)) return set;
        const currentSeconds =
          set.duration_seconds_override ??
          Math.round(setPlan.perSetMinutes! * 60);
        return {
          ...set,
          duration_seconds_override: Math.max(
            30,
            Math.min(180, currentSeconds + secondsDelta)
          ),
        };
      })
    );
  };

  const timerAdjustmentSets = (() => {
    const changed = normalizedSets.filter((set) => set.duration_seconds_override != null);
    const unchanged = normalizedSets.filter((set) => set.duration_seconds_override == null);
    if (changed.length === 0) return normalizedSets;
    if (unchanged.length > 0) return unchanged;
    if (
      changed.every(
        (set) => set.duration_seconds_override === changed[0].duration_seconds_override
      )
    ) {
      return changed;
    }
    return [changed.reduce((latest, set) =>
      set.set_number > latest.set_number ? set : latest
    )];
  })();
  const setTimerLabel =
    timerAdjustmentSets[0] && setPlan.perSetMinutes
      ? `${
          timerAdjustmentSets[0].duration_seconds_override ??
          Math.round(setPlan.perSetMinutes * 60)
        }s`
      : null;

  const gradientColors =
    scheme === "dark"
      ? (["rgba(255,122,26,0.45)", "rgba(28,28,30,0.95)", "rgba(11,11,12,1)"] as const)
      : (["rgba(255,122,26,0.28)", "rgba(255,255,255,0.98)", "rgba(255,255,255,1)"] as const);

  const renderSetRows = () => {
    if (logType === "makes_attempts") {
      return normalizedSets.map((row) => (
        <SetShootingRow
          key={row.set_number}
          setNumber={row.set_number}
          sideLabel={setPlan.setSideLabels?.[row.set_number - 1] ?? null}
          makes={row.makes?.toString() ?? "0"}
          attempts={row.attempts?.toString() ?? "0"}
          targetAttempts={targetAttemptsForSet(row, setPlan)}
          targetMakes={targetMakesForSet(row, setPlan)}
          targetAttemptsDraft={targetAttemptsDrafts[row.set_number]}
          targetMakesDraft={targetMakesDrafts[row.set_number]}
          editMode={editMode}
          completed={row.completed}
          makesDraft={makesDrafts[row.set_number]}
          attemptsDraft={attemptsDrafts[row.set_number]}
          readOnly={readOnly}
          colors={colors}
          onMakesChange={(text) => {
            const digits = text.replace(/[^0-9]/g, "");
            setMakesDrafts((drafts) => ({ ...drafts, [row.set_number]: digits }));
          }}
          onAttemptsChange={(text) => {
            const digits = text.replace(/[^0-9]/g, "");
            setAttemptsDrafts((drafts) => ({ ...drafts, [row.set_number]: digits }));
          }}
          onTargetMakesChange={(text) =>
            setTargetMakesDrafts((drafts) => ({
              ...drafts,
              [row.set_number]: text.replace(/[^0-9]/g, ""),
            }))}
          onTargetAttemptsChange={(text) =>
            setTargetAttemptsDrafts((drafts) => ({
              ...drafts,
              [row.set_number]: text.replace(/[^0-9]/g, ""),
            }))}
          onCommit={() => saveShootingSet(row.set_number)}
        />
      ));
    }

    if (logType === "minutes" || logType === "checkbox") {
      return normalizedSets.map((row) => {
        const side = setPlan.setSideLabels?.[row.set_number - 1];
        const durationSeconds =
          row.duration_seconds_override ??
          (setPlan.perSetMinutes
            ? Math.round(setPlan.perSetMinutes * 60)
            : null);
        const label =
          logType === "minutes" && durationSeconds != null
            ? `Set ${row.set_number}${side ? ` · ${side}` : ""} · ${formatSetDuration(
                durationSeconds
              )}`
            : `Set ${row.set_number}${side ? ` · ${side}` : ""}`;
        return (
          <SetCheckboxRow
            key={row.set_number}
            label={label}
            completed={row.completed}
            readOnly={readOnly}
            colors={colors}
            onToggle={() => toggleSetComplete(row.set_number)}
          />
        );
      });
    }

    return null;
  };

  const cardInner = (
    <>
      <View style={styles.headerRow}>
        <Pressable onPress={toggleExpand} style={styles.headerPressable}>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: colors.text }]}>{exercise.name}</Text>
            {exercise.category ? (
              <Text style={[styles.category, { color: colors.accent }]}>
                {CATEGORY_LABELS[exercise.category] ?? exercise.category}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          <Pressable
            onPress={editMode ? onDelete : toggleExpand}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          >
            <Animated.View
              style={[
                styles.headerCheck,
                {
                  backgroundColor: editMode
                    ? "#DC2626"
                    : completed
                      ? colors.accent
                      : "transparent",
                  borderColor: editMode
                    ? "#DC2626"
                    : completed
                      ? colors.accent
                      : colors.border,
                transform: [{ scale: completionScale }],
                },
              ]}
            >
              {editMode ? (
                <XIcon size={16} color="#FFFFFF" weight="bold" />
              ) : completed ? (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              ) : null}
            </Animated.View>
          </Pressable>
        </View>
      </View>

      {expanded && (
        <View
          style={[
            styles.expandedContent,
            !showVideo && styles.expandedContentNoVideo,
          ]}
        >
          {showVideo ? (
            <View style={styles.videoSection}>
              {videoError ? (
                <Pressable
                  onPress={openInYouTube}
                  style={[styles.videoPlaceholder, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}
                >
                  <Ionicons name="alert-circle-outline" size={22} color={colors.textSecondary} />
                  <Text style={[styles.videoLabel, { color: colors.text }]}>Couldn&apos;t play inline</Text>
                  <View style={[styles.watchOnYoutubeButton, { backgroundColor: colors.accent }]}>
                    <Ionicons name="logo-youtube" size={16} color="#FFFFFF" />
                    <Text style={styles.watchOnYoutubeText}>Watch on YouTube</Text>
                  </View>
                </Pressable>
              ) : !videoStarted ? (
                <Pressable
                  onPress={() => setVideoStarted(true)}
                  style={[styles.videoPlayOverlay, { backgroundColor: "#000", borderColor: colors.border }]}
                >
                  <View style={[styles.playCircle, { backgroundColor: colors.accent }]}>
                    <Ionicons name="play" size={28} color="#FFFFFF" style={{ marginLeft: 3 }} />
                  </View>
                  <Text style={[styles.videoLabel, { color: colors.textSecondary }]}>Tap to play clip</Text>
                </Pressable>
              ) : videoHtml ? (
                <View style={[styles.videoWrapper, { borderColor: colors.border }]}>
                  <WebView
                    source={{ html: videoHtml, baseUrl: "https://www.courtcoachai.org" }}
                    style={styles.webview}
                    originWhitelist={["*"]}
                    allowsFullscreenVideo
                    javaScriptEnabled
                    domStorageEnabled
                    mediaPlaybackRequiresUserAction={false}
                    allowsInlineMediaPlayback
                    scrollEnabled={false}
                    opaque={false}
                    onError={() => {
                      setVideoError(true);
                      reportNetworkFailure("video");
                    }}
                    onHttpError={() => setVideoError(true)}
                    onMessage={(event) => {
                      try {
                        const message = JSON.parse(event.nativeEvent.data) as { type?: string };
                        if (message.type === "youtube_error") setVideoError(true);
                      } catch {
                        // Ignore unexpected messages from the embedded player.
                      }
                    }}
                    startInLoadingState
                    renderLoading={() => (
                      <View style={[styles.webviewLoading, { backgroundColor: colors.cardAlt }]}>
                        <Text style={[styles.videoLabel, { color: colors.textSecondary }]}>Loading clip...</Text>
                      </View>
                    )}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {descriptionText ? (
            <DrillDescriptionView description={descriptionText} colors={colors} compact={!showVideo} />
          ) : null}

          {!readOnly && (
            <View
              style={[
                styles.loggingSection,
                { borderTopColor: colors.border },
                !showVideo && styles.loggingSectionNoVideo,
              ]}
            >
              {hasDrillTimer ? (
                <View style={styles.timerControls}>
                  <Pressable
                    onPress={openDrillTimer}
                    style={[
                      styles.drillTimerButton,
                      { backgroundColor: colors.accentMuted, borderColor: colors.accent },
                    ]}
                  >
                    <TimerIcon size={18} color={colors.accent} weight="bold" />
                    <Text style={[styles.drillTimerButtonText, { color: colors.accent }]}>Timer</Text>
                  </Pressable>
                  <View style={[styles.timerAdjuster, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
                    <Pressable onPress={() => adjustSetTimer(-30)} hitSlop={6} style={styles.timerAdjustButton}>
                      <CaretLeftIcon size={17} color={colors.text} weight="bold" />
                    </Pressable>
                    <Text style={[styles.timerAdjustText, { color: colors.text }]}>{setTimerLabel}</Text>
                    <Pressable onPress={() => adjustSetTimer(30)} hitSlop={6} style={styles.timerAdjustButton}>
                      <CaretRightIcon size={17} color={colors.text} weight="bold" />
                    </Pressable>
                  </View>
                </View>
              ) : null}
              <View style={styles.setRows}>{renderSetRows()}</View>

              {logType === "difficulty_rating" && (
                <View style={styles.difficultyBlock}>
                  <Text style={[styles.smallLabel, { color: colors.textSecondary }]}>How hard was it?</Text>
                  <View style={styles.difficultyRow}>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <Pressable
                        key={d}
                          onPress={() => {
                            hasUserEditsRef.current = true;
                            setDifficulty(d);
                          }}
                        style={[
                          styles.difficultyPill,
                          {
                            backgroundColor: difficulty === d ? colors.accent : colors.cardAlt,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: difficulty === d ? "#FFFFFF" : colors.text,
                            fontWeight: "700",
                          }}
                        >
                          {d}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.notesWrapper}>
                <Text style={[styles.smallLabel, { color: colors.textSecondary }]}>Notes (optional)</Text>
                <RNTextInput
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                  value={userNotes}
                  onChangeText={(text) => {
                    hasUserEditsRef.current = true;
                    setUserNotes(text);
                  }}
                  placeholder="How did it feel?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  style={[
                    styles.notesInput,
                    { backgroundColor: colors.cardAlt, color: colors.text, borderColor: colors.border },
                  ]}
                />
              </View>
            </View>
          )}
        </View>
      )}
    </>
  );

  if (completed) {
    return (
      <View style={[styles.card, styles.cardWrapper, styles.cardShadow]}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradientCard, { borderColor: colors.accent }]}
        >
          {cardInner}
        </LinearGradient>
      </View>
    );
  }

  return (
    <Card style={styles.card} elevated={expanded}>
      {cardInner}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
  },
  cardWrapper: {
    borderRadius: 24,
    overflow: "hidden",
  },
  cardShadow: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
  },
  gradientCard: {
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 18,
  },
  headerPressable: {
    flex: 1,
    paddingRight: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  headerText: {
    flex: 1,
    paddingRight: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 2,
  },
  headerCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 17,
    fontWeight: "700",
  },
  category: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  instructions: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  drillDescription: {
    gap: 6,
    marginBottom: 10,
  },
  drillDescriptionCompact: {
    marginBottom: 6,
  },
  drillIntro: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  drillStepRow: {
    paddingLeft: 2,
  },
  drillStepLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  drillStepText: {
    fontWeight: "400",
  },
  expandedContent: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.25)",
  },
  expandedContentNoVideo: {
    marginTop: 8,
    paddingTop: 8,
  },
  videoSection: {
    marginBottom: 12,
  },
  loggingSectionNoVideo: {
    marginTop: 0,
    paddingTop: 10,
  },
  prescriptionPill: {
    alignSelf: "flex-start",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
  },
  prescriptionText: {
    fontSize: 13,
    fontWeight: "700",
  },
  videoPlayOverlay: {
    borderRadius: 18,
    borderWidth: 1,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  videoWrapper: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    height: 200,
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoPlaceholder: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 26,
    alignItems: "center",
    gap: 10,
  },
  videoLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  watchOnYoutubeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 2,
  },
  watchOnYoutubeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  webviewLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loggingSection: {
    marginTop: 4,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  drillTimerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  drillTimerButtonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  timerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  timerAdjuster: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
  },
  timerAdjustButton: {
    width: 30,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  timerAdjustText: {
    minWidth: 35,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  setRows: {
    gap: 10,
  },
  setRow: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shootingSetRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    padding: 10,
  },
  setNumber: {
    fontSize: 14,
    fontWeight: "800",
  },
  setHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  setTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sideLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  setRowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  setRowHint: {
    fontSize: 12,
    fontWeight: "600",
  },
  setTargetHint: {
    fontSize: 12,
    fontWeight: "600",
  },
  targetEditor: {
    flexDirection: "row",
    alignItems: "center",
  },
  targetInput: {
    width: 36,
    height: 30,
    borderWidth: 1,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    padding: 0,
  },
  shootingInputs: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  shootingCol: {
    flex: 1,
    alignItems: "center",
  },
  shootingLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  shootingInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 19,
    fontFamily: "Poppins_700Bold",
    textAlign: "center",
    width: "100%",
  },
  shootingSlash: {
    fontSize: 28,
    fontWeight: "300",
    marginBottom: 14,
  },
  attemptsTarget: {
    fontSize: 28,
    fontWeight: "800",
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  difficultyBlock: {
    marginTop: 14,
  },
  smallLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  difficultyRow: {
    flexDirection: "row",
    gap: 8,
  },
  difficultyPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  notesWrapper: {
    marginTop: 14,
  },
  notesInput: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    minHeight: 44,
    textAlignVertical: "top",
  },
});
