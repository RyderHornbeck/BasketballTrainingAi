import { useTheme } from "@/hooks/useTheme";
import { BottomTabBar } from "expo-router/js-tabs";
import { ChartLineUpIcon, CourtBasketballIcon, UserCircleIcon } from "phosphor-react-native";
import React, { RefObject } from "react";
import { Text } from "./Text";
import {
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BAR_HEIGHT = 72;
const NAV_BORDER_COLOR = "#F7B379";
const EDGE_INSET = 12;
const COACH_BUTTON_SIZE = TAB_BAR_HEIGHT;
const COACH_GAP = 12;

type BottomTabBarProps = React.ComponentProps<typeof BottomTabBar>;

type BottomTabShellProps = {
  /**
   * The router supplies this in the real tab layout. Tutorial screens can
   * intentionally omit it to render the same locked visual shell only.
   */
  tabBarProps?: BottomTabBarProps;
  onCoachPress?: () => void;
  onCoachLayout?: (event: LayoutChangeEvent) => void;
  coachTargetRef?: RefObject<View | null>;
  /**
   * Prevents tab navigation while retaining the visual shell. The supplied
   * Coach handler can still advance a tutorial without opening the real coach.
   */
  locked?: boolean;
};

export function BottomTabShell({
  tabBarProps,
  onCoachPress,
  onCoachLayout,
  coachTargetRef,
  locked = false,
}: BottomTabShellProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const tabBarWidth =
    screenWidth - EDGE_INSET - COACH_GAP - COACH_BUTTON_SIZE - EDGE_INSET;

  return (
    <>
      <View
        pointerEvents={locked ? "none" : "auto"}
        style={[
          styles.tabBarShell,
          {
            bottom: insets.bottom + 6,
            width: tabBarWidth,
            backgroundColor: colors.card,
            shadowColor: colors.shadow,
            shadowOpacity: scheme === "dark" ? 0.5 : 0.14,
          },
        ]}
      >
        {tabBarProps ? (
          <BottomTabBar {...tabBarProps} style={styles.tabBar} />
        ) : (
          <LockedTabVisual />
        )}
      </View>

      <Pressable
        accessibilityState={{ disabled: locked && !onCoachPress }}
        disabled={locked && !onCoachPress}
        ref={coachTargetRef}
        onLayout={onCoachLayout}
        onPress={onCoachPress}
        style={({ pressed }) => [
          styles.coachButton,
          {
            bottom: insets.bottom + 6,
            width: COACH_BUTTON_SIZE,
            height: COACH_BUTTON_SIZE,
            borderRadius: COACH_BUTTON_SIZE / 2,
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            opacity: pressed ? 0.86 : 1,
          },
        ]}
      >
        <Image
          source={require("../assets/images/WhiteAppLogoForButton.png")}
          style={styles.coachLogo}
          resizeMode="contain"
        />
      </Pressable>
    </>
  );
}

function LockedTabVisual() {
  const { colors } = useTheme();

  return (
    <View style={styles.lockedTabRow} accessibilityElementsHidden>
      <LockedTabItem
        icon={<CourtBasketballIcon size={28} color={colors.accent} weight="fill" />}
        label="Workouts"
        color={colors.accent}
      />
      <LockedTabItem
        icon={<ChartLineUpIcon size={28} color={colors.textMuted} />}
        label="Analytics"
        color={colors.textMuted}
      />
      <LockedTabItem
        icon={<UserCircleIcon size={28} color={colors.textMuted} />}
        label="Profile"
        color={colors.textMuted}
      />
    </View>
  );
}

function LockedTabItem({
  icon,
  label,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.lockedTabItem}>
      {icon}
      <Text style={[styles.lockedTabLabel, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarShell: {
    position: "absolute",
    left: EDGE_INSET,
    height: TAB_BAR_HEIGHT,
    borderRadius: 36,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: NAV_BORDER_COLOR,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 10,
  },
  tabBar: {
    height: TAB_BAR_HEIGHT,
    backgroundColor: "transparent",
    borderTopWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
    paddingBottom: 6,
    paddingTop: 2,
  },
  lockedTabRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingBottom: 4,
    paddingTop: 2,
  },
  lockedTabItem: {
    alignItems: "center",
    gap: 2,
  },
  lockedTabLabel: {
    fontFamily: "Poppins_600SemiBold",
    fontSize: 11,
    lineHeight: 13,
  },
  coachButton: {
    position: "absolute",
    right: EDGE_INSET,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: NAV_BORDER_COLOR,
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
