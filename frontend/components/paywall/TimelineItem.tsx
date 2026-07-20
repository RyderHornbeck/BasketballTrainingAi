import { Text } from "@/components/Text";
import React from "react";
import { StyleSheet, View } from "react-native";

interface TimelineItemProps {
  step: number;
  title: string;
  description: string;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  isLast?: boolean;
}

export function TimelineItem({
  step,
  title,
  description,
  accentColor,
  textColor,
  mutedColor,
  isLast = false,
}: TimelineItemProps) {
  return (
    <View accessible accessibilityLabel={`${step}. ${title}. ${description}`} style={styles.row}>
      <View style={styles.markerColumn}>
        <View style={[styles.marker, { backgroundColor: accentColor }]}>
          <Text style={styles.markerText}>{step}</Text>
        </View>
        {!isLast ? <View style={[styles.line, { backgroundColor: accentColor }]} /> : null}
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        <Text style={[styles.description, { color: mutedColor }]}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    minHeight: 76,
  },
  markerColumn: {
    width: 34,
    alignItems: "center",
  },
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  markerText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  line: {
    width: 2,
    flex: 1,
    opacity: 0.3,
  },
  copy: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 18,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
  },
  description: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 18,
  },
});
