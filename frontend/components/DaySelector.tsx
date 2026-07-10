import { isDayUnlocked } from "@/lib/plan";
import { useTheme } from "@/hooks/useTheme";
import { WorkoutDay } from "@/types/database";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./Text";

interface DaySelectorProps {
  days: WorkoutDay[];
  selectedDayNumber: number;
  onSelect: (dayNumber: number) => void;
}

export function DaySelector({ days, selectedDayNumber, onSelect }: DaySelectorProps) {
  const { colors } = useTheme();

  const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));

  return (
    <View style={styles.wrapper}>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
    >
      {sorted.map((day) => {
        const unlocked = isDayUnlocked(day);
        const selected = day.day_number === selectedDayNumber;
        const completed = day.completed;

        return (
          <Pressable
            key={day.id}
            onPress={() => day.day_number != null && onSelect(day.day_number)}
            hitSlop={6}
            style={[
              styles.circle,
              {
                backgroundColor: selected ? colors.accent : completed ? colors.accentMuted : colors.card,
                borderColor: selected ? colors.accent : colors.border,
                opacity: unlocked ? 1 : 0.4,
              },
              selected && styles.circleSelectedShadow,
            ]}
          >
            <Text
              style={[
                styles.circleText,
                { color: selected ? "#FFFFFF" : completed ? colors.accent : colors.text },
              ]}
            >
              {day.day_number}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 20,
    elevation: 20,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: "center",
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleSelectedShadow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  circleText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
