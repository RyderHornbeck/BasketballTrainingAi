import { useTheme } from "@/hooks/useTheme";
import React from "react";
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: "default" | "alt";
  /** Set false to opt out of the drop shadow (e.g. cards nested inside another elevated surface). */
  elevated?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function Card({ children, style, variant = "default", elevated = true, onLayout }: CardProps) {
  const { colors, scheme } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: variant === "alt" ? colors.cardAlt : colors.card,
          borderColor: colors.border,
          shadowColor: colors.shadow,
        },
        elevated && (scheme === "dark" ? styles.shadowDark : styles.shadowLight),
        style,
      ]}
      onLayout={onLayout}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  shadowDark: {
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
    elevation: 8,
  },
  shadowLight: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 5,
  },
});
