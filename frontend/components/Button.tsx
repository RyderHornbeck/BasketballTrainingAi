import { useTheme } from "@/hooks/useTheme";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: ButtonProps) {
  const { colors, scheme } = useTheme();
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);

  const backgroundColor =
    variant === "primary"
      ? colors.accent
      : variant === "danger"
      ? colors.danger
      : variant === "secondary"
      ? colors.card
      : "transparent";

  const borderColor = variant === "outline" ? colors.accent : "transparent";
  const textColor =
    variant === "primary" || variant === "danger"
      ? "#FFFFFF"
      : variant === "outline"
      ? colors.accent
      : colors.text;

  const isElevated = variant === "primary" || variant === "danger";
  const shadowColor = variant === "primary" ? colors.accent : variant === "danger" ? colors.danger : colors.shadow;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (isDisabled) return;
    scale.value = withTiming(0.96, { duration: 90 });
  };

  const handlePressOut = () => {
    if (isDisabled) return;
    scale.value = withTiming(1, { duration: 140 });
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor,
            borderColor,
            borderWidth: variant === "outline" ? 1.5 : 0,
            opacity: isDisabled ? 0.5 : pressed ? 0.88 : 1,
          },
          isElevated && [
            styles.elevated,
            {
              shadowColor,
              shadowOpacity: pressed ? (scheme === "dark" ? 0.22 : 0.18) : scheme === "dark" ? 0.5 : 0.32,
            },
          ],
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <Text style={[styles.text, { color: textColor }]}>{title}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  elevated: {
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 5,
  },
  text: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
