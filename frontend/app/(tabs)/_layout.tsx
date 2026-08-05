import { AchievementUnlockQueue } from "@/components/AchievementUnlockQueue";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { getAnalyticsSummary, prepareAnalyticsSummary } from "@/lib/analytics";
import { onWorkoutUpdated } from "@/lib/coachEvents";
import { actionHaptic, selectionHaptic } from "@/lib/haptics";
import { hasCurrentAIDataConsent } from "@/lib/aiDataConsent";
import { isDayUnlocked } from "@/lib/plan";
import { router } from "expo-router";
import { ChartLineUpIcon, CourtBasketballIcon, UserCircleIcon } from "phosphor-react-native";
import { BottomTabBar, Tabs } from "expo-router/js-tabs";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  InteractionManager,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BAR_HEIGHT = 72;
const TAB_ICON_SIZE = 28;
const NAV_BORDER_COLOR = "#F7B379";
const EDGE_INSET = 12;
const COACH_BUTTON_SIZE = TAB_BAR_HEIGHT;
const COACH_GAP = 12;

export default function TabsLayout() {
  const { colors, scheme } = useTheme();
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { days } = usePlan();
  const [coachOpen, setCoachOpen] = useState(false);
  const [startupInteractionsComplete, setStartupInteractionsComplete] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setStartupInteractionsComplete(true), 750);
    });
    return () => {
      interaction.cancel();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void prepareAnalyticsSummary(user.id).catch((error) => {
      console.warn("Unable to preload analytics:", error);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    return onWorkoutUpdated(() => {
      void getAnalyticsSummary().catch((error) => {
        console.warn("Unable to refresh preloaded analytics:", error);
      });
    });
  }, [user?.id]);

  // Tab bar stops before the coach button: [12px edge][tab bar][12px gap][64px button][12px edge]
  const tabBarWidth =
    screenWidth - EDGE_INSET - COACH_GAP - COACH_BUTTON_SIZE - EDGE_INSET;

  const coachDay = useMemo(() => {
    if (days.length === 0) return null;
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const nextUp = sorted.find((d) => !d.completed && isDayUnlocked(d, sorted));
    if (nextUp) return nextUp;
    return [...sorted].reverse().find((d) => d.completed) ?? null;
  }, [days]);

  const tabBarShellStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: EDGE_INSET,
      bottom: insets.bottom + 6,
      width: tabBarWidth,
      height: TAB_BAR_HEIGHT,
      borderRadius: 36,
      overflow: "hidden" as const,
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: NAV_BORDER_COLOR,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: scheme === "dark" ? 0.5 : 0.14,
      shadowRadius: 20,
      elevation: 10,
    }),
    [tabBarWidth, insets.bottom, colors, scheme]
  );

  return (
    <>
      <Tabs
        tabBar={(props) => (
          <View style={tabBarShellStyle}>
            <BottomTabBar
              {...props}
              style={{
                height: TAB_BAR_HEIGHT,
                backgroundColor: "transparent",
                borderTopWidth: 0,
                elevation: 0,
                shadowOpacity: 0,
                paddingBottom: 6,
                paddingTop: 2,
              }}
            />
          </View>
        )}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarShowLabel: true,
          tabBarLabelStyle: {
            fontFamily: "Poppins_600SemiBold",
            fontSize: 11,
            lineHeight: 13,
            marginTop: 2,
            marginBottom: 4,
          },
          tabBarItemStyle: {
            paddingTop: 4,
            paddingBottom: 2,
          },
          tabBarIconStyle: {
            marginBottom: 0,
          },
        }}
      >
        <Tabs.Screen
          name="days"
          listeners={{ tabPress: selectionHaptic }}
          options={{
            title: "Workouts",
            tabBarIcon: ({ color, focused }) => (
              <CourtBasketballIcon
                size={TAB_ICON_SIZE}
                color={String(color)}
                weight={focused ? "fill" : "regular"}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="analytics"
          listeners={{ tabPress: selectionHaptic }}
          options={{
            title: "Analytics",
            tabBarIcon: ({ color, focused }) => (
              <ChartLineUpIcon
                size={TAB_ICON_SIZE}
                color={String(color)}
                weight={focused ? "fill" : "regular"}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          listeners={{ tabPress: selectionHaptic }}
          options={{
            title: "Profile",
            tabBarIcon: ({ color, focused }) => (
              <UserCircleIcon
                size={TAB_ICON_SIZE}
                color={String(color)}
                weight={focused ? "fill" : "regular"}
              />
            ),
          }}
        />
      </Tabs>

      <Pressable
        onPress={() => {
          actionHaptic();
          if (!hasCurrentAIDataConsent(profile)) {
            router.push({
              pathname: "/ai-data-processing",
              params: { source: "coach_gate" },
            });
            return;
          }
          setCoachOpen(true);
        }}
        style={({ pressed }) => [
          styles.coachButton,
          {
            bottom: insets.bottom + 6,
            width: COACH_BUTTON_SIZE,
            height: COACH_BUTTON_SIZE,
            borderRadius: COACH_BUTTON_SIZE / 2,
            backgroundColor: colors.accent,
            borderWidth: 2,
            borderColor: NAV_BORDER_COLOR,
            shadowColor: colors.accent,
            opacity: pressed ? 0.86 : 1,
          },
        ]}
      >
        <Image
          source={require("../../assets/images/WhiteAppLogoForButton.png")}
          style={styles.coachLogo}
          resizeMode="contain"
        />
      </Pressable>

      {coachOpen ? (
        <LazyCoachOverlay
          onClose={() => setCoachOpen(false)}
          dayId={coachDay?.id ?? null}
          dayTitle={coachDay?.title ?? null}
        />
      ) : null}
      {startupInteractionsComplete ? (
        <AchievementUnlockQueue userId={user?.id} coachOpen={coachOpen} />
      ) : null}
    </>
  );
}

function LazyCoachOverlay(props: {
  onClose: () => void;
  dayId: string | null;
  dayTitle: string | null;
}) {
  const [CoachOverlay, setCoachOverlay] = React.useState<React.ComponentType<{
    onClose: () => void;
    dayId: string | null;
    dayTitle: string | null;
  }> | null>(null);

  React.useEffect(() => {
    let mounted = true;
    import("@/components/CoachOverlay").then((mod) => {
      if (mounted) setCoachOverlay(() => mod.CoachOverlay);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!CoachOverlay) return null;
  return <CoachOverlay {...props} />;
}

const styles = StyleSheet.create({
  coachButton: {
    position: "absolute",
    right: EDGE_INSET,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  coachLogo: {
    width: 54,
    height: 54,
  },
});
