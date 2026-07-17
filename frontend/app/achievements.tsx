import { Text } from "@/components/Text";
import { useTheme } from "@/hooks/useTheme";
import { ACHIEVEMENTS, AchievementDefinition, getUserAchievements } from "@/lib/achievements";
import { getCurrentWorkoutStreak } from "@/lib/plan";
import { UserAchievement } from "@/types/database";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeftIcon, FireIcon, LockIcon } from "phosphor-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Polygon, Stop } from "react-native-svg";

export default function AchievementsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<UserAchievement[]>([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([getUserAchievements(), getCurrentWorkoutStreak()])
      .then(([earned, currentStreak]) => {
        setUnlocked(earned);
        setStreak(currentStreak);
      })
      .finally(() => setLoading(false));
  }, []);

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
        <ActivityIndicator style={styles.loader} color={colors.accent} />
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
  const borderColor = earned ? darkenColor(definition.color, 0.35) : "#929299";
  const gradientColors: [string, string] = earned
    ? [lightenColor(definition.color, 0.22), darkenColor(definition.color, 0.18)]
    : ["#D3D3D8", "#A6A6AE"];
  const shapeStyle =
    definition.shape === "oval"
      ? styles.triangleWrapper
      : definition.shape === "shield"
        ? styles.shield
        : definition.shape === "diamond"
          ? styles.diamond
          : styles.circle;

  return (
    <View style={styles.badgeCard}>
      {definition.shape === "oval" ? (
        <TriangleBadge colors={gradientColors} borderColor={borderColor}>
          {earned ? <Icon size={27} color="#FFFFFF" weight="fill" /> : <LockIcon size={24} color="#F5F5F7" weight="fill" />}
        </TriangleBadge>
      ) : (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.badgeShape, shapeStyle, { borderColor }]}
        >
          <View style={definition.shape === "diamond" ? styles.diamondContent : undefined}>
            {earned ? (
              <Icon size={31} color="#FFFFFF" weight="fill" />
            ) : (
              <LockIcon size={27} color="#F5F5F7" weight="fill" />
            )}
          </View>
        </LinearGradient>
      )}
      <Text style={[styles.badgeTitle, { color: earned ? colors.text : colors.textMuted }]}>
        {definition.title}
      </Text>
      <Text style={[styles.badgeDescription, { color: colors.textSecondary }]}>
        {definition.description}
      </Text>
    </View>
  );
}

function TriangleBadge({
  colors,
  borderColor,
  children,
}: {
  colors: [string, string];
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.triangleWrapper}>
      <Svg width={82} height={74} viewBox="0 0 82 74">
        <Defs>
          <SvgLinearGradient id="badgeTriangleGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </SvgLinearGradient>
        </Defs>
        <Polygon
          points="4,5 78,5 41,69"
          fill="url(#badgeTriangleGradient)"
          stroke={borderColor}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </Svg>
      <View pointerEvents="none" style={styles.triangleIcon}>{children}</View>
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
  loader: { marginTop: 60 },
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
    minHeight: 174,
    alignItems: "center",
  },
  badgeShape: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    marginBottom: 11,
    borderWidth: 3,
  },
  circle: { borderRadius: 36 },
  shield: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: 36, borderBottomRightRadius: 36 },
  diamond: { width: 58, height: 58, marginTop: 9, marginBottom: 20, borderRadius: 12, transform: [{ rotate: "45deg" }] },
  diamondContent: { transform: [{ rotate: "-45deg" }] },
  triangleWrapper: {
    width: 82,
    height: 74,
    marginTop: 2,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  triangleIcon: { position: "absolute", top: 17, alignItems: "center", justifyContent: "center" },
  badgeTitle: { fontSize: 12, fontWeight: "800", textAlign: "center" },
  badgeDescription: { marginTop: 5, fontSize: 10, lineHeight: 14, textAlign: "center" },
});
