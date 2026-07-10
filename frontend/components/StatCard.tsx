import { useTheme } from "@/hooks/useTheme";
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { Card } from "./Card";
import { Text } from "./Text";

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatCard({ label, value, sublabel, style }: StatCardProps) {
  const { colors } = useTheme();

  return (
    <Card style={[styles.card, style]}>
      <Text style={[styles.value, { color: colors.accent }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      {sublabel ? (
        <Text style={[styles.sublabel, { color: colors.textMuted }]}>{sublabel}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
  },
  value: {
    fontSize: 26,
    fontWeight: "800",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  sublabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
