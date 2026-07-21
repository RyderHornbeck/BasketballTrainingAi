import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { ACHIEVEMENTS, AchievementDefinition, getUserAchievements } from "@/lib/achievements";
import { getWorkoutUpdateRevision } from "@/lib/coachEvents";
import { getCurrentWorkoutStreak } from "@/lib/plan";
import { UserAchievement } from "@/types/database";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowLeftIcon, FireIcon, LockIcon } from "phosphor-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface CachedAchievementPage {
  userId: string;
  revision: number;
  unlocked: UserAchievement[];
  streak: number;
}

let achievementPageCache: CachedAchievementPage | null = null;
let achievementPageRequest: {
  userId: string;
  revision: number;
  promise: Promise<CachedAchievementPage>;
} | null = null;

function fetchAchievementPage(userId: string, revision: number): Promise<CachedAchievementPage> {
  if (
    achievementPageRequest?.userId === userId &&
    achievementPageRequest.revision === revision
  ) {
    return achievementPageRequest.promise;
  }

  const promise = Promise.all([getUserAchievements(), getCurrentWorkoutStreak()])
    .then(([unlocked, streak]) => {
      const next = { userId, revision, unlocked, streak };
      achievementPageCache = next;
      return next;
    })
    .finally(() => {
      if (achievementPageRequest?.promise === promise) achievementPageRequest = null;
    });
  achievementPageRequest = { userId, revision, promise };
  return promise;
}

export default function AchievementsScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id ?? null;
  const initialCache =
    userId && achievementPageCache?.userId === userId ? achievementPageCache : null;
  const [unlocked, setUnlocked] = useState<UserAchievement[]>(
    () => initialCache?.unlocked ?? []
  );
  const [streak, setStreak] = useState(() => initialCache?.streak ?? 0);
  const [loading, setLoading] = useState(() => !initialCache);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const revision = getWorkoutUpdateRevision();
      const cached =
        achievementPageCache?.userId === userId ? achievementPageCache : null;

      if (cached) {
        setUnlocked(cached.unlocked);
        setStreak(cached.streak);
        setLoading(false);
        if (cached.revision === revision) return;
      } else {
        setUnlocked([]);
        setStreak(0);
        setLoading(true);
      }

      let active = true;
      void fetchAchievementPage(userId, revision)
        .then((next) => {
          if (!active) return;
          setUnlocked(next.unlocked);
          setStreak(next.streak);
        })
        .catch((error) => {
          console.warn("Unable to load achievements:", error);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [userId])
  );

  const unlockedByKey = useMemo(
    () => new Map(unlocked.map((achievement) => [achievement.achievement_key, achievement])),
    [unlocked]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ArrowLeftIcon size={24} color={colors.text} weight="bold" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Achievements</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <AchievementsSkeleton />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.streakIcon, { backgroundColor: colors.accentMuted }]}>
              <FireIcon size={34} color="#F97316" weight="fill" />
            </View>
            <View>
              <Text style={[styles.streakLabel, { color: colors.textSecondary }]}>Current streak</Text>
              <Text style={[styles.streakValue, { color: colors.text }]}>
                {streak} {streak === 1 ? "day" : "days"}
              </Text>
            </View>
          </View>

          <View style={styles.collectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Badge collection</Text>
            <Text style={[styles.collectionCount, { color: colors.textSecondary }]}>
              {unlocked.length}/{ACHIEVEMENTS.length}
            </Text>
          </View>
          <View style={styles.grid}>
            {ACHIEVEMENTS.map((definition) => (
              <BadgeCard
                key={definition.key}
                definition={definition}
                unlocked={unlockedByKey.get(definition.key)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function AchievementsSkeleton() {
  const { colors } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.streakCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Skeleton width={56} height={56} borderRadius={18} />
        <View style={styles.streakSkeletonCopy}>
          <Skeleton width={100} height={13} borderRadius={6} />
          <Skeleton width={82} height={27} borderRadius={8} />
        </View>
      </View>

      <View style={styles.collectionHeader}>
        <Skeleton width={155} height={24} borderRadius={8} />
        <Skeleton width={48} height={17} borderRadius={7} />
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 12 }, (_, index) => (
          <View key={index} style={styles.badgeSkeleton}>
            <Skeleton width={80} height={80} borderRadius={40} />
            <Skeleton width="82%" height={13} borderRadius={6} style={styles.badgeSkeletonTitle} />
            <Skeleton width="96%" height={10} borderRadius={5} />
            <Skeleton width="70%" height={10} borderRadius={5} style={styles.badgeSkeletonLine} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function BadgeCard({
  definition,
  unlocked,
}: {
  definition: AchievementDefinition;
  unlocked?: UserAchievement;
}) {
  const { colors } = useTheme();
  const earned = Boolean(unlocked);
  const Icon = definition.icon;
  const borderColor = earned ? darkenColor(definition.color, 0.4) : "#7B808A";
  const rimColor = earned ? lightenColor(definition.color, 0.58) : "#F4F4F5";
  const gradientColors: [string, string, string, string, string] = earned
    ? [
        darkenColor(definition.color, 0.34),
        lightenColor(definition.color, 0.08),
        lightenColor(definition.color, 0.58),
        lightenColor(definition.color, 0.14),
        darkenColor(definition.color, 0.3),
      ]
    : ["#ADB1B9", "#A9ADB5", "#A5A9B1", "#A0A4AD", "#9B9FA8"];
  const shapeStyle =
    definition.shape === "shield"
      ? styles.shield
      : definition.shape === "diamond"
        ? styles.diamond
        : styles.circle;

  return (
    <View style={styles.badgeCard}>
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.23, 0.47, 0.68, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[
          styles.badgeShape,
          shapeStyle,
          { borderColor },
          !earned && styles.lockedBadgeShape,
        ]}
      >
        {earned ? (
          <>
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
          </>
        ) : null}
        <View
          style={[
            styles.iconPlate,
            definition.shape === "diamond" ? styles.diamondContent : undefined,
          ]}
        >
            {earned ? (
              <Icon size={32} color="#FFFFFF" weight="fill" />
            ) : (
              <LockIcon size={28} color="#F5F5F7" weight="fill" />
            )}
        </View>
      </LinearGradient>
      <Text style={[styles.badgeTitle, { color: earned ? colors.text : colors.textMuted }]}>
        {definition.title}
      </Text>
      <Text style={[styles.badgeDescription, { color: colors.textSecondary }]}>
        {definition.description}
      </Text>
    </View>
  );
}

function darkenColor(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const transform = (offset: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount))))
      .toString(16)
      .padStart(2, "0");
  return `#${transform(0)}${transform(2)}${transform(4)}`;
}

function lightenColor(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const transform = (offset: number) =>
    Math.round(parseInt(value.slice(offset, offset + 2), 16) + (255 - parseInt(value.slice(offset, offset + 2), 16)) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${transform(0)}${transform(2)}${transform(4)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 54,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 19, fontWeight: "800" },
  headerSpacer: { width: 24 },
  scroll: { padding: 18, paddingBottom: 60 },
  streakCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  streakIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  streakLabel: { fontSize: 12, fontWeight: "600" },
  streakValue: { marginTop: 2, fontSize: 24, fontWeight: "800" },
  streakSkeletonCopy: {
    gap: 7,
  },
  collectionHeader: {
    marginTop: 28,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 20, fontWeight: "800" },
  collectionCount: { fontSize: 14, fontWeight: "800" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    columnGap: "3.8%",
    rowGap: 24,
  },
  badgeCard: {
    width: "30.8%",
    minHeight: 182,
    alignItems: "center",
  },
  badgeSkeleton: {
    width: "30.8%",
    minHeight: 182,
    alignItems: "center",
  },
  badgeSkeletonTitle: {
    marginTop: 12,
    marginBottom: 7,
  },
  badgeSkeletonLine: {
    marginTop: 5,
  },
  badgeShape: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    marginBottom: 11,
    borderWidth: 3,
    overflow: "hidden",
    shadowColor: "#0A0A0C",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 7,
    elevation: 6,
  },
  lockedBadgeShape: {
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  circle: { borderRadius: 40 },
  shield: { borderTopLeftRadius: 27, borderTopRightRadius: 27, borderBottomLeftRadius: 40, borderBottomRightRadius: 40 },
  diamond: { width: 64, height: 64, marginTop: 10, marginBottom: 22, borderRadius: 13, transform: [{ rotate: "45deg" }] },
  diamondContent: { transform: [{ rotate: "-45deg" }] },
  metalHighlight: {
    position: "absolute",
    top: 5,
    left: 10,
    width: "72%",
    height: 24,
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
  shieldRim: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 31, borderBottomRightRadius: 31 },
  diamondRim: { inset: 5, borderRadius: 9 },
  iconPlate: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTitle: { fontSize: 12, fontWeight: "800", textAlign: "center" },
  badgeDescription: { marginTop: 5, fontSize: 10, lineHeight: 14, textAlign: "center" },
});
