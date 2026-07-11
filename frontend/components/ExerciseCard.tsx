import { useTheme } from "@/hooks/useTheme";
import {
  aggregateSetLogs,
  applyAttemptsOverride,
  buildSetPlan,
  decodeExerciseLogMeta,
  encodeExerciseLogMeta,
  hydrateSetLogs,
  normalizeSetLogs,
  resolveAttemptsOverride,
  SetLogEntry,
} from "@/lib/exerciseSetLogs";
import { ExerciseLogInput } from "@/lib/plan";
import { buildYouTubeClipHtml } from "@/lib/youtubePlayer";
import { hasVideoDemo } from "@/lib/exerciseClip";
import { parseDrillDescription } from "@/lib/drillDescription";
import { WorkoutExerciseWithClip } from "@/types/plan";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, TextInput as RNTextInput, View } from "react-native";
import { WebView } from "react-native-webview";
import { Card } from "./Card";
import { Text } from "./Text";

interface ExerciseCardProps {
  exercise: WorkoutExerciseWithClip;
  readOnly?: boolean;
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
  basketball_iq: "Basketball IQ",
};

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
      style={[
        styles.setRow,
        { backgroundColor: completed ? colors.accentMuted : colors.cardAlt, borderColor: colors.border },
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
  completed,
  onMakesChange,
  onAttemptsChange,
  readOnly,
  colors,
}: {
  setNumber: number;
  sideLabel?: string | null;
  makes: string;
  attempts: string;
  targetAttempts: number | null;
  targetMakes: number | null;
  completed: boolean;
  onMakesChange: (value: string) => void;
  onAttemptsChange: (value: string) => void;
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
        <Text style={[styles.setNumber, { color: colors.text }]}>Set {setNumber}</Text>
        {sideLabel ? (
          <Text style={[styles.sideLabel, { color: colors.accent }]}>{sideLabel}</Text>
        ) : null}
      </View>
      <View style={styles.shootingInputs}>
        <View style={styles.shootingCol}>
          <Text style={[styles.shootingLabel, { color: colors.textSecondary }]}>Makes</Text>
          <RNTextInput
            value={makes}
            onChangeText={readOnly ? undefined : onMakesChange}
            editable={!readOnly}
            keyboardType="number-pad"
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
            value={attempts}
            onChangeText={readOnly ? undefined : onAttemptsChange}
            editable={!readOnly}
            keyboardType="number-pad"
            placeholder={targetAttempts != null ? String(targetAttempts) : "0"}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.shootingInput,
              { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
            ]}
          />
        </View>
      </View>
      {targetMakes != null ? (
        <Text style={[styles.setTargetHint, { color: colors.textMuted }]}>
          Target {targetMakes} makes
        </Text>
      ) : null}
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
      {parsed.repeat ? (
        <Text style={[styles.drillRepeat, { color: colors.textMuted }]}>{parsed.repeat}.</Text>
      ) : null}
    </View>
  );
}

export function ExerciseCard({ exercise, readOnly, onLogChange }: ExerciseCardProps) {
  const { colors, scheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);

  const baseSetPlan = useMemo(() => buildSetPlan(exercise), [exercise]);
  const [attemptsOverride, setAttemptsOverride] = useState<number | null>(() => {
    const meta = decodeExerciseLogMeta(exercise.log?.notes ?? null);
    const logs = hydrateSetLogs(baseSetPlan, meta, exercise.log ?? undefined);
    return resolveAttemptsOverride(meta, logs);
  });
  const setPlan = useMemo(
    () => applyAttemptsOverride(baseSetPlan, attemptsOverride),
    [baseSetPlan, attemptsOverride]
  );
  const logType = setPlan.logType;

  const displayPrescription = useMemo(() => {
    const { setCount, perSetAttempts, setSideLabels } = setPlan;
    if (logType === "makes_attempts" && perSetAttempts != null) {
      const shotLabel = perSetAttempts === 1 ? "1 shot" : `${perSetAttempts} shots`;
      let label =
        setCount === 1 ? `1 set · ${shotLabel}` : `${setCount} sets · ${shotLabel} each`;
      if (setSideLabels?.length) label += " · alternate sides";
      return label;
    }
    return setPlan.prescriptionLabel;
  }, [setPlan, logType]);

  const [setLogs, setSetLogs] = useState<SetLogEntry[]>(() =>
    hydrateSetLogs(setPlan, decodeExerciseLogMeta(exercise.log?.notes ?? null), exercise.log ?? undefined)
  );
  const [difficulty, setDifficulty] = useState(exercise.log?.difficulty ?? 0);
  const [userNotes, setUserNotes] = useState(
    () => decodeExerciseLogMeta(exercise.log?.notes ?? null).user_notes ?? ""
  );

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
    setSetLogs(hydrated);
    setDifficulty(exercise.log?.difficulty ?? 0);
    setUserNotes(meta.user_notes ?? "");
    setExpanded(false);
    setVideoStarted(false);
    setVideoError(false);
  }, [exercise.id, exercise.log, baseSetPlan]);

  const clip = exercise.video_clip;
  const showVideo = hasVideoDemo(clip);
  const descriptionText =
    clip?.description ?? exercise.instructions ?? clip?.coaching_notes ?? null;
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
    nextAttemptsOverride = attemptsOverride
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
      }),
    });
  };

  const updateSet = (setNumber: number, patch: Partial<SetLogEntry>) => {
    setSetLogs((prev) =>
      prev.map((row) => (row.set_number === setNumber ? { ...row, ...patch } : row))
    );
  };

  useEffect(() => {
    emitLog(setLogs, difficulty, userNotes, attemptsOverride);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLogs, difficulty, userNotes, attemptsOverride, setPlan]);

  const syncAttemptsAcrossSets = (text: string) => {
    const attemptsNum = text ? parseInt(text.replace(/[^0-9]/g, ""), 10) : 0;
    if (!attemptsNum || attemptsNum <= 0) {
      setAttemptsOverride(null);
      const resetPlan = applyAttemptsOverride(baseSetPlan, null);
      setSetLogs((prev) =>
        prev.map((row) => {
          const makesNum = row.makes ?? 0;
          const attempts = resetPlan.perSetAttempts;
          return {
            ...row,
            attempts,
            completed: row.makes != null && (attempts ?? 0) > 0,
          };
        })
      );
      return;
    }

    const scaledPlan = applyAttemptsOverride(baseSetPlan, attemptsNum);
    setAttemptsOverride(attemptsNum);
    setSetLogs((prev) =>
      prev.map((row) => {
        const makesNum = row.makes ?? 0;
        return {
          ...row,
          attempts: attemptsNum,
          completed:
            row.makes != null && attemptsNum > 0,
        };
      })
    );
  };

  const toggleSetComplete = (setNumber: number) => {
    const row = setLogs.find((s) => s.set_number === setNumber);
    if (!row) return;
    const next = !row.completed;
    updateSet(setNumber, {
      completed: next,
      minutes: next ? setPlan.perSetMinutes : null,
    });
  };

  const toggleExpand = () => setExpanded((v) => !v);

  const openInYouTube = () => {
    if (watchUrl) Linking.openURL(watchUrl);
  };

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
          makes={row.makes?.toString() ?? ""}
          attempts={row.attempts?.toString() ?? ""}
          targetAttempts={setPlan.perSetAttempts}
          targetMakes={setPlan.perSetMakes}
          completed={row.completed}
          readOnly={readOnly}
          colors={colors}
          onMakesChange={(text) => {
            const makesNum = text ? parseInt(text.replace(/[^0-9]/g, ""), 10) : 0;
            const attemptsNum = row.attempts ?? setPlan.perSetAttempts ?? 0;
            updateSet(row.set_number, {
              makes: text ? makesNum : null,
              completed: Boolean(text) && attemptsNum > 0,
            });
          }}
          onAttemptsChange={syncAttemptsAcrossSets}
        />
      ));
    }

    if (logType === "minutes" || logType === "checkbox") {
      return normalizedSets.map((row) => {
        const side = setPlan.setSideLabels?.[row.set_number - 1];
        const label =
          logType === "minutes" && setPlan.perSetMinutes
            ? `Set ${row.set_number}${side ? ` · ${side}` : ""} · ${setPlan.perSetMinutes} min`
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
          <Pressable onPress={toggleExpand} hitSlop={8}>
            <View
              style={[
                styles.headerCheck,
                {
                  backgroundColor: completed ? colors.accent : "transparent",
                  borderColor: completed ? colors.accent : colors.border,
                },
              ]}
            >
              {completed ? (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              ) : null}
            </View>
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
                    source={{ html: videoHtml, baseUrl: "https://hoopplan.app" }}
                    style={styles.webview}
                    originWhitelist={["*"]}
                    allowsFullscreenVideo
                    javaScriptEnabled
                    domStorageEnabled
                    mediaPlaybackRequiresUserAction={false}
                    allowsInlineMediaPlayback
                    scrollEnabled={false}
                    opaque={false}
                    onError={() => setVideoError(true)}
                    onHttpError={() => setVideoError(true)}
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

          {displayPrescription ? (
            <View
              style={[
                styles.prescriptionPill,
                {
                  backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.prescriptionText, { color: colors.textSecondary }]}>
                {displayPrescription}
              </Text>
            </View>
          ) : null}

          {!readOnly && (
            <View
              style={[
                styles.loggingSection,
                { borderTopColor: colors.border },
                !showVideo && styles.loggingSectionNoVideo,
              ]}
            >
              <View style={styles.setRows}>{renderSetRows()}</View>

              {logType === "difficulty_rating" && (
                <View style={styles.difficultyBlock}>
                  <Text style={[styles.smallLabel, { color: colors.textSecondary }]}>How hard was it?</Text>
                  <View style={styles.difficultyRow}>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <Pressable
                        key={d}
                        onPress={() => setDifficulty(d)}
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
                  value={userNotes}
                  onChangeText={setUserNotes}
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
  drillRepeat: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 4,
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
    gap: 12,
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
    alignSelf: "flex-end",
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
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 22,
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
