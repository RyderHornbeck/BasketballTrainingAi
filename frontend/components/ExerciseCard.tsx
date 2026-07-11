import { useTheme } from "@/hooks/useTheme";
import { ExerciseLogInput } from "@/lib/plan";
import { buildYouTubeClipHtml } from "@/lib/youtubePlayer";
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

function parseTargetMinutes(exercise: WorkoutExerciseWithClip): number | null {
  const sources = [exercise.duration, exercise.reps];
  for (const value of sources) {
    if (!value) continue;
    const match = value.match(/(\d+)\s*min/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function buildPreviewBubbles(exercise: WorkoutExerciseWithClip): string[] {
  const bubbles: string[] = [];
  if (exercise.sets) {
    const n = parseInt(exercise.sets, 10);
    bubbles.push(n === 1 ? "1 set" : `${exercise.sets} sets`);
  }
  if (exercise.duration) {
    const minMatch = exercise.duration.match(/(\d+)\s*min/i);
    if (minMatch) bubbles.push(`${minMatch[1]} min`);
    else bubbles.push(exercise.duration);
  } else if (exercise.reps) {
    const minMatch = exercise.reps.match(/(\d+)\s*min/i);
    if (minMatch) bubbles.push(`${minMatch[1]} min`);
  }
  if (exercise.target_makes != null) {
    bubbles.push(`${exercise.target_makes} makes`);
  }
  if (exercise.target_attempts != null) {
    bubbles.push(`${exercise.target_attempts} attempts`);
  }
  return bubbles;
}

function BubbleRow({
  labels,
  scheme,
  colors,
}: {
  labels: string[];
  scheme: "light" | "dark";
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  if (labels.length === 0) return null;
  return (
    <View style={styles.bubbleRow}>
      {labels.map((label) => (
        <View
          key={label}
          style={[
            styles.bubble,
            {
              backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.bubbleText, { color: colors.textSecondary }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ExerciseCard({ exercise, readOnly, onLogChange }: ExerciseCardProps) {
  const { colors, scheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);

  const [completed, setCompleted] = useState(exercise.log?.completed ?? false);
  const [makes, setMakes] = useState(exercise.log?.makes?.toString() ?? "");
  const [minutes, setMinutes] = useState(exercise.log?.minutes_completed?.toString() ?? "");
  const [difficulty, setDifficulty] = useState(exercise.log?.difficulty ?? 0);
  const [notes, setNotes] = useState(exercise.log?.notes ?? "");

  const logType = exercise.log_type ?? "checkbox";
  const targetMakes = exercise.target_makes ?? null;
  const targetAttempts = exercise.target_attempts ?? null;

  const targetMinutes = parseTargetMinutes(exercise);

  const previewBubbles = useMemo(() => buildPreviewBubbles(exercise), [exercise]);

  useEffect(() => {
    setCompleted(exercise.log?.completed ?? false);
    setMakes(exercise.log?.makes?.toString() ?? "");
    setMinutes(exercise.log?.minutes_completed?.toString() ?? "");
    setDifficulty(exercise.log?.difficulty ?? 0);
    setNotes(exercise.log?.notes ?? "");
    setExpanded(false);
    setVideoStarted(false);
    setVideoError(false);
  }, [exercise.id, exercise.log]);

  const clip = exercise.video_clip;
  const watchUrl = clip
    ? `https://www.youtube.com/watch?v=${clip.youtube_video_id}&t=${clip.start_seconds}s`
    : null;

  const videoHtml = useMemo(() => {
    if (!clip || !videoStarted) return null;
    return buildYouTubeClipHtml(clip.youtube_video_id, clip.start_seconds, clip.end_seconds, {
      autoplay: true,
    });
  }, [clip, videoStarted]);

  // Auto-complete when makes hit the target (shooting drills).
  useEffect(() => {
    if (logType !== "makes_attempts" || targetMakes == null) return;
    const makesNum = makes ? parseInt(makes, 10) : 0;
    const hitTarget = makesNum >= targetMakes;
    if (hitTarget !== completed) setCompleted(hitTarget);
  }, [makes, targetMakes, logType, completed]);

  useEffect(() => {
    const makesNum = makes ? parseInt(makes, 10) : null;
    const attemptsNum =
      logType === "makes_attempts" && targetAttempts != null
        ? targetAttempts
        : null;

    onLogChange({
      exercise_id: exercise.id,
      completed,
      makes: makesNum,
      attempts: attemptsNum,
      minutes_completed: minutes ? parseInt(minutes, 10) : null,
      difficulty: difficulty || null,
      notes: notes || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, makes, minutes, difficulty, notes, targetAttempts, logType]);

  const openInYouTube = () => {
    if (watchUrl) Linking.openURL(watchUrl);
  };

  const gradientColors =
    scheme === "dark"
      ? (["rgba(255,122,26,0.45)", "rgba(28,28,30,0.95)", "rgba(11,11,12,1)"] as const)
      : (["rgba(255,122,26,0.28)", "rgba(255,255,255,0.98)", "rgba(255,255,255,1)"] as const);

  const toggleCompleted = () => {
    if (readOnly) return;
    if (logType === "makes_attempts" && targetMakes != null) {
      const makesNum = makes ? parseInt(makes, 10) : 0;
      if (!completed && makesNum < targetMakes) {
        setMakes(String(targetMakes));
      }
      setCompleted(!completed);
      return;
    }
    if (logType === "minutes") {
      const next = !completed;
      setCompleted(next);
      if (next) {
        setMinutes(targetMinutes != null ? String(targetMinutes) : "");
      } else {
        setMinutes("");
      }
      return;
    }
    setCompleted(!completed);
  };

  const cardInner = (
    <>
      <View style={styles.headerRow}>
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.headerPressable}>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: colors.text }]}>{exercise.name}</Text>
            {exercise.category ? (
              <Text style={[styles.category, { color: colors.accent }]}>
                {CATEGORY_LABELS[exercise.category] ?? exercise.category}
              </Text>
            ) : null}
          </View>

          {exercise.instructions ? (
            <Text
              style={[styles.instructions, { color: colors.textSecondary }]}
              numberOfLines={expanded ? undefined : 2}
            >
              {exercise.instructions}
            </Text>
          ) : null}

          <BubbleRow labels={previewBubbles} scheme={scheme} colors={colors} />
        </Pressable>

        <View style={styles.headerActions}>
          {!expanded && (completed || !readOnly) ? (
            <Pressable
              onPress={readOnly ? undefined : toggleCompleted}
              disabled={readOnly}
              hitSlop={8}
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
            </Pressable>
          ) : null}
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        </View>
      </View>

      {expanded && (
        <View style={styles.expandedContent}>
          {clip ? (
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

          {!readOnly && (
            <View style={[styles.loggingSection, { borderTopColor: colors.border }]}>
              {logType === "checkbox" && (
                <Pressable
                  onPress={() => setCompleted(!completed)}
                  style={[
                    styles.checkboxRow,
                    { backgroundColor: completed ? colors.accentMuted : colors.cardAlt },
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
                  <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                    {completed ? "Marked complete" : "Mark complete"}
                  </Text>
                </Pressable>
              )}

              {logType === "makes_attempts" && (
                <View style={styles.shootingRow}>
                  <View style={styles.shootingCol}>
                    <Text style={[styles.shootingLabel, { color: colors.textSecondary }]}>Makes</Text>
                    <RNTextInput
                      value={makes}
                      onChangeText={(t) => setMakes(t.replace(/[^0-9]/g, ""))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      style={[
                        styles.shootingInput,
                        { backgroundColor: colors.cardAlt, color: colors.text, borderColor: colors.border },
                      ]}
                    />
                  </View>

                  <Text style={[styles.shootingSlash, { color: colors.textMuted }]}>/</Text>

                  <View style={styles.shootingCol}>
                    <Text style={[styles.shootingLabel, { color: colors.textSecondary }]}>Attempts</Text>
                    <Text style={[styles.attemptsTarget, { color: colors.text }]}>
                      {targetAttempts ?? "—"}
                    </Text>
                  </View>
                </View>
              )}

              {logType === "minutes" && (
                <Pressable
                  onPress={() => {
                    const next = !completed;
                    setCompleted(next);
                    if (next) {
                      setMinutes(targetMinutes != null ? String(targetMinutes) : "");
                    } else {
                      setMinutes("");
                    }
                  }}
                  style={[
                    styles.checkboxRow,
                    { backgroundColor: completed ? colors.accentMuted : colors.cardAlt },
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
                  <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                    {completed ? "Completed" : "Mark complete"}
                  </Text>
                </Pressable>
              )}

              {logType === "difficulty_rating" && (
                <View>
                  <Text style={[styles.smallLabel, { color: colors.textSecondary }]}>How hard was it?</Text>
                  <View style={styles.difficultyRow}>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <Pressable
                        key={d}
                        onPress={() => {
                          setDifficulty(d);
                          setCompleted(true);
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
                  value={notes}
                  onChangeText={setNotes}
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
  bubbleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  bubble: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bubbleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  expandedContent: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.25)",
  },
  videoSection: {
    marginBottom: 12,
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
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    padding: 14,
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
  checkboxLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  shootingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 8,
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
  numberInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
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
