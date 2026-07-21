import { useTheme } from "@/hooks/useTheme";
import React from "react";
import { DimensionValue, StyleProp, View, ViewStyle } from "react-native";

interface SkeletonProps {
  width?: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = "100%",
  height,
  borderRadius = 12,
  style,
}: SkeletonProps) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.progressTrack,
          opacity: 0.78,
        },
        style,
      ]}
    />
  );
}
