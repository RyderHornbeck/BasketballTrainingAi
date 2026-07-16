import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { parseDrillDescription } from "@/lib/drillDescription";
import { hasVideoDemo } from "@/lib/exerciseClip";
import { buildYouTubeClipHtml } from "@/lib/youtubePlayer";
import { ExerciseVideoClip } from "@/types/database";
import { PlayIcon } from "phosphor-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export function DrillPreview({ clip }: { clip: ExerciseVideoClip }) {
  const { colors } = useTheme();
  const [playing, setPlaying] = useState(false);
  const description = clip.description ?? clip.coaching_notes ?? "";
  const parsed = useMemo(() => parseDrillDescription(description), [description]);
  const videoHtml = useMemo(
    () =>
      playing && hasVideoDemo(clip)
        ? buildYouTubeClipHtml(clip.youtube_video_id, clip.start_seconds, clip.end_seconds, {
            autoplay: true,
          })
        : null,
    [clip, playing]
  );

  return (
    <View style={styles.content}>
      {hasVideoDemo(clip) ? (
        playing && videoHtml ? (
          <View style={[styles.video, { borderColor: colors.border }]}>
            <WebView
              source={{ html: videoHtml, baseUrl: "https://courtcoach.app" }}
              originWhitelist={["*"]}
              allowsFullscreenVideo
              javaScriptEnabled
              domStorageEnabled
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              scrollEnabled={false}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setPlaying(true)}
            style={[styles.playCard, { backgroundColor: "#000000", borderColor: colors.border }]}
          >
            <View style={[styles.playCircle, { backgroundColor: colors.accent }]}>
              <PlayIcon size={28} color="#FFFFFF" weight="fill" />
            </View>
            <Text style={[styles.playText, { color: "#FFFFFF" }]}>Play drill video</Text>
          </Pressable>
        )
      ) : null}

      <View style={[styles.instructions, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Instructions</Text>
        {parsed.intro ? (
          <Text style={[styles.intro, { color: colors.textSecondary }]}>{parsed.intro}</Text>
        ) : null}
        {parsed.steps.map((step) => (
          <View key={step.number} style={styles.step}>
            <View style={[styles.stepNumber, { backgroundColor: colors.accentMuted }]}>
              <Text style={[styles.stepNumberText, { color: colors.accent }]}>{step.number}</Text>
            </View>
            <Text style={[styles.stepText, { color: colors.textSecondary }]}>{step.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  video: {
    height: 220,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 18,
    backgroundColor: "#000000",
  },
  playCard: {
    height: 220,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  playCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  playText: { fontSize: 14, fontWeight: "700" },
  instructions: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 13 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  intro: { fontSize: 14, lineHeight: 21 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontSize: 13, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 21, paddingTop: 3 },
});
