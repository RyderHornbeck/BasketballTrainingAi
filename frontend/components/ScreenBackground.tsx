import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View, ViewProps } from "react-native";

interface ScreenBackgroundProps extends ViewProps {
  children: React.ReactNode;
}

export function ScreenBackground({ children, style, ...rest }: ScreenBackgroundProps) {
  const { colors, scheme } = useTheme();

  const gradientColors =
    scheme === "dark"
      ? ([
          "rgba(255,122,26,0.16)",
          "rgba(255,122,26,0.08)",
          "rgba(255,122,26,0.03)",
          "rgba(11,11,12,0.98)",
          colors.background,
        ] as const)
      : ([
          colors.gradientGlow,
          "rgba(255,122,26,0.04)",
          "rgba(255,255,255,0.98)",
          colors.background,
        ] as const);

  const gradientLocations =
    scheme === "dark" ? ([0, 0.15, 0.32, 0.58, 1] as const) : ([0, 0.28, 0.62, 1] as const);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }, style]} {...rest}>
      <LinearGradient
        pointerEvents="none"
        colors={gradientColors}
        locations={gradientLocations}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
