import AsyncStorage from "@react-native-async-storage/async-storage";
import { NoConnectionBanner } from "@/components/NoConnectionBanner";
import { ACHIEVEMENTS, AchievementDefinition, getUserAchievements } from "@/lib/achievements";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { LinearGradient } from "expo-linear-gradient";
import { CheckCircleIcon } from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";

const seenStorageKey = (userId: string) => `court-coach.achievement-unlocks.seen.${userId}`;

export function AchievementUnlockQueue({
  userId,
  coachOpen,
}: {
  userId: string | null | undefined;
  coachOpen: boolean;
}) {
  const [queue, setQueue] = useState<AchievementDefinition[]>([]);
  const [scale] = useState(() => new Animated.Value(0.82));
  const [opacity] = useState(() => new Animated.Value(0));

  const refreshQueue = useCallback(async () => {
    if (!userId) return;

    const [earned, rawSeen] = await Promise.all([
      getUserAchievements(),
      AsyncStorage.getItem(seenStorageKey(userId)),
    ]);
    const earnedKeys = earned.map((achievement) => achievement.achievement_key);
    let storedKeys: string[] = [];
    let hasValidSeenState = rawSeen != null;
    try {
      const parsed = rawSeen ? JSON.parse(rawSeen) : [];
      if (!Array.isArray(parsed) || !parsed.every((key) => typeof key === "string")) {
        hasValidSeenState = false;
      } else {
        storedKeys = parsed;
      }
    } catch {
      hasValidSeenState = false;
    }
    const seen = new Set<string>(storedKeys);

    // Any caller that observes missing or invalid local state must silently
    // establish the baseline. Multiple startup refreshes can overlap, so a
    // per-component "initialized" flag is not safe here: a second request
    // could otherwise enqueue the member's entire existing collection.
    if (!hasValidSeenState) {
      await AsyncStorage.setItem(seenStorageKey(userId), JSON.stringify(earnedKeys));
      return;
    }

    const newDefinitions = earnedKeys
      .filter((key) => !seen.has(key))
      .map((key) => ACHIEVEMENTS.find((achievement) => achievement.key === key))
      .filter((achievement): achievement is AchievementDefinition => Boolean(achievement));

    if (!newDefinitions.length) return;
    await AsyncStorage.setItem(seenStorageKey(userId), JSON.stringify([...new Set([...seen, ...earnedKeys])]));
    setQueue((current) => {
      const currentKeys = new Set(current.map((achievement) => achievement.key));
      return [...current, ...newDefinitions.filter((achievement) => !currentKeys.has(achievement.key))];
    });
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      const timeout = setTimeout(() => setQueue([]), 0);
      return () => clearTimeout(timeout);
    }
    const timeout = setTimeout(() => {
      void refreshQueue();
    }, 0);
    return () => clearTimeout(timeout);
  }, [refreshQueue, userId]);

  useEffect(() => onWorkoutUpdated(() => void refreshQueue()), [refreshQueue]);

  useEffect(() => {
    if (coachOpen) return;
    const timeout = setTimeout(() => {
      void refreshQueue();
    }, 0);
    return () => clearTimeout(timeout);
  }, [coachOpen, refreshQueue]);

  const current = coachOpen ? null : queue[0] ?? null;

  useEffect(() => {
    if (!current) return;
    scale.setValue(0.82);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [current, opacity, scale]);

  const dismiss = () => {
    Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setQueue((currentQueue) => currentQueue.slice(1));
    });
  };

  if (!current) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <NoConnectionBanner />
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <LinearGradient colors={["#FFF7ED", "#FFE2C6"]} style={styles.badgeGlow}>
            <MetallicUnlockBadge definition={current} />
          </LinearGradient>
          <Text style={styles.eyebrow}>ACHIEVEMENT UNLOCKED</Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.description}>{current.description}</Text>
          <Pressable onPress={dismiss} style={({ pressed }) => [styles.button, { backgroundColor: current.color, opacity: pressed ? 0.86 : 1 }]}>
            <CheckCircleIcon size={20} color="#FFFFFF" weight="fill" />
            <Text style={styles.buttonText}>Awesome</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function MetallicUnlockBadge({ definition }: { definition: AchievementDefinition }) {
  const Icon = definition.icon;
  const gradientColors: [string, string, string, string, string] = [
    darkenColor(definition.color, 0.34),
    lightenColor(definition.color, 0.08),
    lightenColor(definition.color, 0.58),
    lightenColor(definition.color, 0.14),
    darkenColor(definition.color, 0.3),
  ];
  const borderColor = darkenColor(definition.color, 0.4);
  const rimColor = lightenColor(definition.color, 0.58);

  const shapeStyle =
    definition.shape === "shield"
      ? styles.shieldBadge
      : definition.shape === "diamond"
        ? styles.diamondBadge
        : styles.circleBadge;

  return (
    <LinearGradient
      colors={gradientColors}
      locations={[0, 0.23, 0.47, 0.68, 1]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.metalBadge, shapeStyle, { borderColor }]}
    >
      <View pointerEvents="none" style={styles.metalHighlight} />
      <View
        pointerEvents="none"
        style={[
          styles.metalRim,
          definition.shape === "shield" ? styles.shieldRim : undefined,
          definition.shape === "diamond" ? styles.diamondRim : undefined,
          { borderColor: rimColor },
        ]}
      />
      <View style={definition.shape === "diamond" ? styles.diamondBadgeContent : undefined}>
        <Icon size={40} color="#FFFFFF" weight="fill" />
      </View>
    </LinearGradient>
  );
}

function darkenColor(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const transform = (offset: number) =>
    Math.max(
      0,
      Math.min(255, Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount)))
    )
      .toString(16)
      .padStart(2, "0");
  return `#${transform(0)}${transform(2)}${transform(4)}`;
}

function lightenColor(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const transform = (offset: number) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${transform(0)}${transform(2)}${transform(4)}`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 19, 0.56)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 30,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 26,
    paddingBottom: 26,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 14,
  },
  badgeGlow: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -46,
    marginBottom: 18,
  },
  metalBadge: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    overflow: "hidden",
    shadowColor: "#0A0A0C",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 7,
  },
  circleBadge: { borderRadius: 44 },
  shieldBadge: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
  },
  diamondBadge: {
    width: 72,
    height: 72,
    borderRadius: 14,
    transform: [{ rotate: "45deg" }],
  },
  diamondBadgeContent: { transform: [{ rotate: "-45deg" }] },
  metalHighlight: {
    position: "absolute",
    top: 5,
    left: 10,
    width: "72%",
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.3)",
    transform: [{ rotate: "-18deg" }],
  },
  metalRim: {
    position: "absolute",
    inset: 5,
    borderWidth: 1.4,
    borderRadius: 999,
    borderBottomColor: "rgba(0,0,0,0.24)",
  },
  shieldRim: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },
  diamondRim: { borderRadius: 10 },
  eyebrow: { color: "#A16207", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { marginTop: 8, color: "#18181B", fontSize: 27, fontWeight: "800", textAlign: "center" },
  description: { marginTop: 8, color: "#71717A", fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: {
    width: "100%",
    minHeight: 52,
    marginTop: 24,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
