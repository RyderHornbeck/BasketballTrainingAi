import AsyncStorage from "@react-native-async-storage/async-storage";
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
  const initializedForUser = useRef<string | null>(null);
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
    try {
      storedKeys = rawSeen ? JSON.parse(rawSeen) : [];
    } catch {
      // Treat a malformed local cache as a new install rather than blocking unlocks.
      storedKeys = [];
    }
    const seen = new Set<string>(storedKeys);

    // Do not replay a member's existing collection after an app install.
    if (initializedForUser.current !== userId && rawSeen == null) {
      initializedForUser.current = userId;
      await AsyncStorage.setItem(seenStorageKey(userId), JSON.stringify(earnedKeys));
      return;
    }
    initializedForUser.current = userId;

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
      initializedForUser.current = null;
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
  const Icon = current.icon;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <LinearGradient colors={["#FFF7ED", "#FFE2C6"]} style={styles.badgeGlow}>
            <View style={[styles.badge, { backgroundColor: current.color }]}>
              <Icon size={48} color="#FFFFFF" weight="fill" />
            </View>
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
  badge: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#FFFFFF",
  },
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
