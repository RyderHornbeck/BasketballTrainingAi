import { useTheme } from "@/hooks/useTheme";
import { usePlan } from "@/hooks/usePlan";
import { isDayUnlocked } from "@/lib/plan";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { BottomTabBar } from "expo-router/build/react-navigation/bottom-tabs";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BAR_HEIGHT = 64;
const EDGE_INSET = 12;
const COACH_BUTTON_SIZE = 64;
const COACH_GAP = 12;

export default function TabsLayout() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { days } = usePlan();
  const [coachOpen, setCoachOpen] = useState(false);

  // Tab bar stops before the coach button: [12px edge][tab bar][12px gap][64px button][12px edge]
  const tabBarWidth =
    screenWidth - EDGE_INSET - COACH_GAP - COACH_BUTTON_SIZE - EDGE_INSET;

  const coachDay = useMemo(() => {
    if (days.length === 0) return null;
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const nextUp = sorted.find((d) => !d.completed && isDayUnlocked(d));
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
      borderWidth: 1,
      borderColor: colors.border,
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
                paddingBottom: 0,
                paddingTop: 0,
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
          },
          tabBarItemStyle: {
            paddingTop: 8,
          },
        }}
      >
        <Tabs.Screen
          name="days"
          options={{
            title: "Days",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "basketball" : "basketball-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: "Analytics",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "stats-chart" : "stats-chart-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={size} color={color} />
            ),
          }}
        />
      </Tabs>

      <Pressable
        onPress={() => setCoachOpen(true)}
        style={({ pressed }) => [
          styles.coachButton,
          {
            bottom: insets.bottom + 6,
            width: COACH_BUTTON_SIZE,
            height: COACH_BUTTON_SIZE,
            borderRadius: COACH_BUTTON_SIZE / 2,
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}
      >
        <Ionicons name="basketball" size={30} color="#FFFFFF" />
      </Pressable>

      {coachOpen ? (
        <LazyCoachOverlay
          onClose={() => setCoachOpen(false)}
          dayId={coachDay?.id ?? null}
          dayTitle={coachDay?.title ?? null}
        />
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
});
