import { AchievementUnlockQueue } from "@/components/AchievementUnlockQueue";
import { BottomTabShell } from "@/components/BottomTabShell";
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
import { Tabs } from "expo-router/js-tabs";
import React, { useEffect, useMemo, useState } from "react";
import { InteractionManager } from "react-native";

const TAB_ICON_SIZE = 28;

export default function TabsLayout() {
  const { colors } = useTheme();
  const { user, profile } = useAuth();
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

  const coachDay = useMemo(() => {
    if (days.length === 0) return null;
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const nextUp = sorted.find((d) => !d.completed && isDayUnlocked(d, sorted));
    if (nextUp) return nextUp;
    return [...sorted].reverse().find((d) => d.completed) ?? null;
  }, [days]);

  const handleCoachPress = () => {
    actionHaptic();
    if (!hasCurrentAIDataConsent(profile)) {
      router.push({
        pathname: "/ai-data-processing",
        params: { source: "coach_gate" },
      });
      return;
    }
    setCoachOpen(true);
  };

  return (
    <>
      <Tabs
        tabBar={(props) => <BottomTabShell tabBarProps={props} onCoachPress={handleCoachPress} />}
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

