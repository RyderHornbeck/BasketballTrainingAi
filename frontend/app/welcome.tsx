import { Button } from "@/components/Button";
import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { Link, router, useFocusEffect } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback } from "react";
import { Image, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const player = useVideoPlayer(require("../assets/videos/draft3.mov"), (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = false;
  });
  const stopWelcomeVideo = useCallback(() => {
    player.pause();
    player.currentTime = 0;
  }, [player]);

  useFocusEffect(
    useCallback(() => {
      player.currentTime = 0;
      player.play();
      return stopWelcomeVideo;
    }, [player, stopWelcomeVideo]),
  );

  return (
    <LinearGradient
      colors={["rgba(247,179,121,0.30)", colors.background, colors.background]}
      locations={[0, 0.42, 1]}
      style={styles.flex}
    >
      <SafeAreaView style={styles.flex}>
        <View style={styles.content}>
          <View style={styles.brand}>
            <Image
              accessibilityLabel="Court Coach AI"
              source={require("../assets/images/AppLogo.png")}
              resizeMode="contain"
              style={styles.appLogo}
            />
            <Text style={[styles.appName, { color: colors.text }]}>Court Coach</Text>
            <Text style={[styles.tagline, { color: colors.textSecondary }]}>
              Your AI Coach for Basketball Training in your ear.
            </Text>
          </View>

          <View style={styles.videoSection}>
            <View style={[styles.videoFrame, { borderColor: colors.accent }]}>
              <VideoView
                player={player}
                contentFit="cover"
                nativeControls={false}
                style={styles.video}
              />
            </View>
            <Text style={[styles.videoHint, { color: colors.textSecondary }]}>
              Turn up volume to hear Court Coach
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              title="Get Started"
              onPress={() => {
                stopWelcomeVideo();
                router.push("/onboarding");
              }}
              style={styles.button}
              buttonStyle={styles.buttonPill}
            />
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                Already have an account?
              </Text>
              <Link href="/auth/login" onPress={stopWelcomeVideo}>
                <Text style={[styles.footerLink, { color: colors.accent }]}> Log in</Text>
              </Link>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    padding: 24,
    paddingBottom: 32,
  },
  brand: {
    alignItems: "center",
    marginTop: 24,
  },
  appLogo: {
    width: 72,
    height: 72,
  },
  appName: {
    fontSize: 34,
    fontWeight: "800",
    marginTop: 12,
  },
  tagline: {
    fontSize: 16,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  videoSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  videoFrame: {
    width: "76%",
    aspectRatio: 0.8,
    borderWidth: 2,
    borderRadius: 20,
    overflow: "hidden",
  },
  video: {
    flex: 1,
  },
  videoHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "600",
  },
  actions: {
    width: "100%",
  },
  button: {
    width: "100%",
  },
  buttonPill: {
    borderRadius: 999,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "700",
  },
});
