import { useTheme } from "@/hooks/useTheme";
import { selectionHaptic } from "@/lib/haptics";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";

interface SkillSliderProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
}

export function SkillSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 10,
  lowLabel = "Just starting",
  highLabel = "Elite",
}: SkillSliderProps) {
  const { colors, scheme } = useTheme();
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <View
          style={[
            styles.valueBadge,
            {
              backgroundColor: colors.accentMuted,
              shadowColor: colors.accent,
              shadowOpacity: scheme === "dark" ? 0.3 : 0.15,
            },
          ]}
        >
          <Text style={[styles.valueText, { color: colors.accent }]}>
            {value == null ? "Select" : `${value}/${max}`}
          </Text>
        </View>
      </View>
      <View style={styles.stepsRow}>
        {steps.map((step) => {
          const active = value != null && step <= value;
          return (
            <Pressable
              key={step}
              onPress={() => {
                selectionHaptic();
                onChange(step);
              }}
              hitSlop={4}
              style={[
                styles.step,
                {
                  backgroundColor: active ? colors.accent : colors.cardAlt,
                  borderColor: active ? colors.accent : colors.border,
                },
                active && {
                  shadowColor: colors.accent,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: scheme === "dark" ? 0.5 : 0.3,
                  shadowRadius: 4,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.captionRow}>
        <Text style={[styles.caption, { color: colors.textMuted }]}>{lowLabel}</Text>
        <Text style={[styles.caption, { color: colors.textMuted }]}>{highLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 26,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
  },
  valueBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  valueText: {
    fontSize: 12,
    fontWeight: "700",
  },
  stepsRow: {
    flexDirection: "row",
    gap: 5,
  },
  step: {
    flex: 1,
    height: 16,
    borderRadius: 7,
    borderWidth: 1,
  },
  captionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  caption: {
    fontSize: 11,
    fontWeight: "500",
  },
});
