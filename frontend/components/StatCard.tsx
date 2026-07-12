import { useTheme } from "@/hooks/useTheme";
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { Card } from "./Card";
import { Text } from "./Text";

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon?: React.ReactNode;
  valueColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatCard({ label, value, sublabel, icon, valueColor, style }: StatCardProps) {
  const { colors } = useTheme();

  return (
    <Card style={[styles.card, style]}>
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={[styles.value, { color: valueColor ?? colors.accent }]}>{value}</Text>
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
  iconWrap: {
    marginBottom: 6,
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
